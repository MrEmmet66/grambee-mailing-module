package tasks

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"time"

	"github.com/hibiken/asynq"
	"github.com/sirupsen/logrus"

	"go-mailing-worker/internal/metrics"
	"go-mailing-worker/internal/models"
	"go-mailing-worker/internal/telegram"
)

const (
	TypeSendMessage = "send_message"
)

// SendMessageHandler обрабатывает задачи отправки сообщений
type SendMessageHandler struct {
	telegramClient *telegram.Client
	metricsTracker *metrics.MetricsTracker
}

// NewSendMessageHandler создает новый обработчик
func NewSendMessageHandler(telegramClient *telegram.Client, metricsTracker *metrics.MetricsTracker) *SendMessageHandler {
	return &SendMessageHandler{
		telegramClient: telegramClient,
		metricsTracker: metricsTracker,
	}
}

// FloodWaitError представляет ошибку FLOOD_WAIT от Telegram API
type FloodWaitError struct {
	RetryAfter int
	Message    string
}

func (e *FloodWaitError) Error() string {
	return e.Message
}

// NewSendMessageTask создает новую задачу отправки сообщения
func NewSendMessageTask(taskData models.SendMessageTask) (*asynq.Task, error) {
	payload, err := json.Marshal(taskData)
	if err != nil {
		return nil, err
	}

	return asynq.NewTask(TypeSendMessage, payload), nil
}

// HandleSendMessage обрабатывает задачу отправки сообщения
func (h *SendMessageHandler) HandleSendMessage(ctx context.Context, t *asynq.Task) error {
	var taskData models.SendMessageTask
	if err := json.Unmarshal(t.Payload(), &taskData); err != nil {
		return fmt.Errorf("failed to unmarshal task payload: %w", err)
	}

	logger := logrus.WithFields(logrus.Fields{
		"mailing_id":  taskData.MailingID,
		"chat_id":     taskData.ChatID,
		"user_index":  taskData.UserIndex,
		"total_users": taskData.TotalUsers,
	})

	logger.Info("Processing send message task")

	// ВАЖНО: Создаем клиент с токеном из задачи, а не общий
	telegramClient := telegram.NewClient(taskData.BotToken)

	startTime := time.Now()

	var err error
	var apiCallTime time.Duration

	// Определяем тип сообщения и отправляем
	apiStart := time.Now()
	if taskData.MessageData.PostMedia != "" {
		// Отправка медиа-сообщения
		err = telegramClient.SendMediaMessage(
			taskData.ChatID,
			taskData.MessageData,
			taskData.InlineKeyboard,
		)
	} else {
		// Отправка текстового сообщения
		err = telegramClient.SendTextMessage(
			taskData.ChatID,
			taskData.MessageData.Text,
			taskData.InlineKeyboard,
		)
	}
	apiCallTime = time.Since(apiStart)

	if err != nil {
		// Проверяем, является ли это FLOOD_WAIT ошибкой
		if floodWaitErr := parseFloodWaitError(err); floodWaitErr != nil {
			logger.WithFields(logrus.Fields{
				"retry_after": floodWaitErr.RetryAfter,
				"api_time":    apiCallTime.Milliseconds(),
			}).Warn("FLOOD_WAIT detected, sleeping for specified duration")

			// Обновляем метрики флуд-вейта
			h.metricsTracker.UpdateFloodWait(ctx, taskData.MailingID, floodWaitErr.RetryAfter)

			// Приостанавливаем выполнение на время FLOOD_WAIT
			sleepDuration := time.Duration(floodWaitErr.RetryAfter) * time.Second

			// Проверяем контекст во время сна, чтобы можно было прервать
			select {
			case <-time.After(sleepDuration):
				// Время ожидания прошло, пытаемся отправить снова
				logger.WithField("retry_after", floodWaitErr.RetryAfter).Info("FLOOD_WAIT period ended, retrying message send")

				// Повторная попытка отправки
				apiStart = time.Now()
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
				apiCallTime = time.Since(apiStart)

				if err != nil {
					// После FLOOD_WAIT любая ошибка = конец, НЕ возвращаем ошибку для ретрая
					logger.WithFields(logrus.Fields{
						"error":    err.Error(),
						"api_time": apiCallTime.Milliseconds(),
					}).Error("Failed to send message after FLOOD_WAIT - task completed without retry")

					// Обновляем метрики неудачи
					h.metricsTracker.UpdateMessageFailed(ctx, taskData.MailingID)

					// НЕ возвращаем ошибку - задача считается выполненной
					return nil
				}

			case <-ctx.Done():
				// Контекст отменен - НЕ ретрай
				logger.Warn("Task context cancelled during FLOOD_WAIT - task completed")
				return nil
			}
		} else {
			// ЛЮБАЯ ошибка кроме FLOOD_WAIT = НЕ ретрай, идем дальше!
			logger.WithFields(logrus.Fields{
				"error":    err.Error(),
				"api_time": apiCallTime.Milliseconds(),
			}).Error("Failed to send message - task completed without retry")

			// Обновляем метрики неудачи
			h.metricsTracker.UpdateMessageFailed(ctx, taskData.MailingID)

			// НЕ возвращаем ошибку - задача считается выполненной
			return nil
		}
	}

	totalTime := time.Since(startTime)

	// Обновляем метрики успешной отправки
	h.metricsTracker.UpdateMessageSent(ctx, taskData.MailingID, apiCallTime.Milliseconds())

	// Создаем результат выполнения для asynqmon
	result := models.TaskResult{
		Success:     true,
		MailingID:   taskData.MailingID,
		ChatID:      taskData.ChatID,
		UserIndex:   taskData.UserIndex,
		TotalUsers:  taskData.TotalUsers,
		APICallTime: apiCallTime.Milliseconds(),
		TotalTime:   totalTime.Milliseconds(),
		CompletedAt: time.Now().UTC().Format(time.RFC3339),
	}

	// Сохраняем результат в Redis для asynqmon
	if resultData, err := json.Marshal(result); err == nil {
		// Результат будет доступен в asynqmon
		logger.WithField("result", string(resultData)).Debug("Task completed successfully")
	}

	logger.WithFields(logrus.Fields{
		"api_time":   apiCallTime.Milliseconds(),
		"total_time": totalTime.Milliseconds(),
	}).Info("Message sent successfully")

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
