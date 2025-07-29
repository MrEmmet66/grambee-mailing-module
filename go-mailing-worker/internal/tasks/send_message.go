package tasks

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/hibiken/asynq"
	"github.com/sirupsen/logrus"

	"go-mailing-worker/internal/metrics"
	"go-mailing-worker/internal/models"
	"go-mailing-worker/internal/ratelimiter"
	"go-mailing-worker/internal/telegram"
)

// Глобальные переменные для подсчета скорости
var (
	taskCounter int64
	startTime   = time.Now()
	lastLog     = time.Now()
	logMutex    sync.Mutex
)

const (
	TypeSendMessage = "send_message"
)

// FloodWaitError представляет ошибку FLOOD_WAIT от Telegram API
type FloodWaitError struct {
	RetryAfter int
	Message    string
}

func (e *FloodWaitError) Error() string {
	return e.Message
}

// SendMessageHandler обрабатывает задачи отправки сообщений
type SendMessageHandler struct {
	telegramClient *telegram.Client
	rateLimiter    ratelimiter.RateLimiter
	metricsTracker *metrics.MetricsTracker
}

// NewSendMessageHandler создает новый обработчик
func NewSendMessageHandler(telegramClient *telegram.Client, rateLimiter ratelimiter.RateLimiter, metricsTracker *metrics.MetricsTracker) *SendMessageHandler {
	return &SendMessageHandler{
		telegramClient: telegramClient,
		rateLimiter:    rateLimiter,
		metricsTracker: metricsTracker,
	}
}

// NewSendMessageTask создает новую задачу отправки сообщения
func NewSendMessageTask(taskData models.SendMessageTask) (*asynq.Task, error) {
	payload, err := json.Marshal(taskData)
	if err != nil {
		return nil, err
	}

	// Используем уникальный TaskID для предотвращения повторного добавления задачи
	taskID := fmt.Sprintf("%s_%s", taskData.MailingID, taskData.ChatID)
	return asynq.NewTask(TypeSendMessage, payload, asynq.TaskID(taskID)), nil
}

// HandleSendMessage обрабатывает задачи отправки сообщения
func (h *SendMessageHandler) HandleSendMessage(ctx context.Context, t *asynq.Task) error {
	// Увеличиваем счетчик обработанных задач
	currentCount := atomic.AddInt64(&taskCounter, 1)

	// Логируем скорость каждые 100 задач
	logMutex.Lock()
	if currentCount%100 == 0 || time.Since(lastLog) > 10*time.Second {
		elapsed := time.Since(startTime)
		actualRate := float64(currentCount) / elapsed.Seconds()
		logrus.WithFields(logrus.Fields{
			"actual_rate_msg_sec": fmt.Sprintf("%.2f", actualRate),
			"total_processed":     currentCount,
			"elapsed_seconds":     fmt.Sprintf("%.1f", elapsed.Seconds()),
		}).Info("ACTUAL RATE")
		lastLog = time.Now()
	}
	logMutex.Unlock()

	var taskData models.SendMessageTask
	if err := json.Unmarshal(t.Payload(), &taskData); err != nil {
		return fmt.Errorf("failed to unmarshal task payload: %w", err)
	}

	// ГЛОБАЛЬНЫЙ RATE LIMITER: Получаем общий rate limiter для bot token
	globalManager := ratelimiter.GetGlobalManager()
	sharedRateLimiter := globalManager.GetRateLimiter(taskData.BotToken, taskData.MailingID)
	sharedRateLimiter.Wait()

	// ВАЖНО: Создаем клиент с токеном из задачи
	telegramClient := telegram.NewClient(taskData.BotToken)

	// МЕТРИКИ: Отслеживаем время отправки
	sendStartTime := time.Now()
	var err error

	// Определяем тип сообщения и отправляем
	if taskData.MessageData.PostMedia != "" {
		err = telegramClient.SendMediaMessage(
			taskData.ChatID,
			taskData.MessageData,
			taskData.InlineKeyboard,
		)
		if err != nil {
			logrus.WithField("chat_id", taskData.ChatID).Error("Ошибка отправки медиа сообщения")
		}
	} else {
		logrus.WithFields(logrus.Fields{
			"mailing_id": taskData.MailingID,
			"chat_id":    taskData.ChatID,
		}).Info("[TG] Отправка текстового сообщения")
		err = telegramClient.SendTextMessage(
			taskData.ChatID,
			taskData.MessageData.Text,
			taskData.InlineKeyboard,
		)
	}

	// НОВАЯ ЛОГИКА: Обработка ошибок для правильного распределения по asynq статусам
	if err != nil {
		// Проверяем, является ли это FLOOD_WAIT ошибкой
		if floodWaitErr := parseFloodWaitError(err); floodWaitErr != nil {

			now := time.Now()
			// Обновляем статистику FLOOD_WAIT только если с момента последнего FLOOD_WAIT прошло больше времени, чем retryAfter
			lastFloodWait := sharedRateLimiter.GetLastFloodWaitTime()
			if lastFloodWait.IsZero() || now.Sub(lastFloodWait) > time.Duration(floodWaitErr.RetryAfter)*time.Second {
				if h.metricsTracker != nil {
					h.metricsTracker.UpdateFloodWait(ctx, taskData.MailingID, floodWaitErr.RetryAfter)
				}
			}
			sharedRateLimiter.OnFloodWait(floodWaitErr.RetryAfter)

			logrus.WithFields(logrus.Fields{
				"mailing_id":  taskData.MailingID,
				"retry_after": floodWaitErr.RetryAfter,
			}).Warn("[TG] FLOOD_WAIT detected")
			sleepDuration := time.Duration(floodWaitErr.RetryAfter) * time.Second
			select {
			case <-time.After(sleepDuration):
				// Повторно пытаемся отправить
				if taskData.MessageData.PostMedia != "" {
					err = telegramClient.SendMediaMessage(
						taskData.ChatID,
						taskData.MessageData,
						taskData.InlineKeyboard,
					)
				} else {
					err = telegramClient.SendTextMessage(
						taskData.ChatID,
						taskData.MessageData.Text,
						taskData.InlineKeyboard,
					)
				}
				// Если повторная попытка неуспешна - это failed для asynq
				if err != nil {
					sharedRateLimiter.OnProcessed()
					return fmt.Errorf("DELIVERY_FAILED: %w", err)
				}
				// ИСПРАВЛЯЕМ: Если повторная попытка успешна, тоже вызываем OnProcessed()
				sharedRateLimiter.OnProcessed()
			case <-ctx.Done():
				sharedRateLimiter.OnProcessed() // ИСПРАВЛЯЕМ: Добавляем OnProcessed() при отмене контекста
				return fmt.Errorf("DELIVERY_FAILED: context cancelled during FLOOD_WAIT")
			}
		} else {
			// ВСЕ ОСТАЛЬНЫЕ ОШИБКИ = FAILED в asynq (не ретраятся)
			sharedRateLimiter.OnProcessed()
			return asynq.SkipRetry // Немедленно удаляем задачу из очереди
		}
	} else {

		// ИСПРАВЛЯЕМ: Успешная отправка с первой попытки
		sharedRateLimiter.OnProcessed()
	}

	// МЕТРИКИ: Обновляем только вспомогательную информацию (НЕ счетчики)
	if h.metricsTracker != nil {
		responseTime := time.Since(sendStartTime).Milliseconds()
		// Обновляем только rate limiter и среднее время ответа
		h.metricsTracker.UpdateRateLimiter(ctx, taskData.MailingID, sharedRateLimiter.GetCurrentRate(), sharedRateLimiter.GetMaxRate())
		h.metricsTracker.UpdateResponseTime(ctx, taskData.MailingID, responseTime)
	}

	return nil
}

// parseFloodWaitError парсит ошибку и возвращает FloodWaitError если это FLOOD_WAIT
func parseFloodWaitError(err error) *FloodWaitError {
	errorMsg := err.Error()

	// Паттерны для различных форматов FLOOD_WAIT
	patterns := []string{
		`FLOOD_WAIT_(\d+)`,
		`retry after (\d+)`,
		`Too Many Requests: retry after (\d+)`,
	}

	for _, pattern := range patterns {
		re := regexp.MustCompile(pattern)
		matches := re.FindStringSubmatch(errorMsg)
		if len(matches) >= 2 {
			if retryAfter, err := strconv.Atoi(matches[1]); err == nil {
				return &FloodWaitError{
					RetryAfter: retryAfter,
					Message:    fmt.Sprintf("FLOOD_WAIT: retry after %d seconds", retryAfter),
				}
			}
		}
	}

	// Проверяем код ошибки 429
	if regexp.MustCompile(`429|Too Many Requests`).MatchString(errorMsg) {
		return &FloodWaitError{
			RetryAfter: 10, // Значение по умолчанию
			Message:    "FLOOD_WAIT: retry after 10 seconds (default)",
		}
	}

	return nil
}
