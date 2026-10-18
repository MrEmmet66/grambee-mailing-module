package handlers

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hibiken/asynq"
	"github.com/sirupsen/logrus"

	"go-mailing-worker/internal/manager"
	"go-mailing-worker/internal/metrics"
	"go-mailing-worker/internal/models"
	"go-mailing-worker/internal/tasks"
	"go-mailing-worker/internal/utils"
)

// MailingHandler содержит обработчики для рассылок
type MailingHandler struct {
	client         *asynq.Client
	metricsTracker *metrics.MetricsTracker
	workerManager  *manager.WorkerManager
}

// NewMailingHandler создает новый обработчик рассылок
func NewMailingHandler(client *asynq.Client, metricsTracker *metrics.MetricsTracker, workerManager *manager.WorkerManager) *MailingHandler {
	return &MailingHandler{
		client:         client,
		metricsTracker: metricsTracker,
		workerManager:  workerManager,
	}
}

// CreateMailing создает новую рассылку
func (h *MailingHandler) CreateMailing(c *gin.Context) {
	var req models.MailingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "Invalid request format",
			"details": err.Error(),
		})
		return
	}

	// Устанавливаем значения по умолчанию
	if req.RateLimit <= 0 {
		req.RateLimit = 25 // 25 сообщений в секунду по умолчанию
	}

	logrus.WithFields(logrus.Fields{
		"mailing_id": req.MailingID,
		"users_file": req.UsersFileURL,
		"rate_limit": req.RateLimit,
	}).Info("Creating new mailing")

	// Загружаем пользователей из файла
	users, err := loadUsersFromFile(req.UsersFileURL)
	if err != nil {
		logrus.WithError(err).Error("Failed to load users from file")
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "Failed to load users from file",
			"details": err.Error(),
		})
		return
	}

	if len(users) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "No users found in file",
		})
		return
	}

	logrus.WithField("user_count", len(users)).Info("Loaded users from file")

	// Инициализируем метрики для рассылки
	if err := h.metricsTracker.InitMailingMetrics(c.Request.Context(), req.MailingID, len(users)); err != nil {
		logrus.WithError(err).Warn("Failed to initialize metrics")
	}

	// Запускаем изолированный воркер для этой рассылки
	worker, err := h.workerManager.StartWorker(req.MailingID, len(users))
	if err != nil {
		logrus.WithError(err).Error("Failed to start dedicated worker")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to start dedicated worker",
			"details": err.Error(),
		})
		return
	}

	logrus.WithFields(logrus.Fields{
		"mailing_id": req.MailingID,
		"worker_pid": worker.ProcessID,
		"queue_name": worker.QueueName,
	}).Info("Started dedicated worker for mailing")

	// Создаем задачи для каждого пользователя в изолированной очереди
	totalTasks := 0
	failedTasks := 0
	queueName := worker.QueueName

	for i, user := range users {
		taskData := models.SendMessageTask{
			MailingID:      req.MailingID,
			BotToken:       req.BotToken,
			ChatID:         user.UserID,
			MessageData:    req.MessageData,
			InlineKeyboard: req.InlineKeyboard,
			AdminChatID:    req.AdminChatID,
			AdminMessageID: req.AdminMessageID,
			UserIndex:      i + 1,
			TotalUsers:     len(users),
			// Метаданные для asynqmon
			CreatedAt: time.Now().UTC().Format(time.RFC3339),
			Queue:     queueName, // Используем изолированную очередь воркера
			Priority:  1,
		}

		task, err := tasks.NewSendMessageTask(taskData)
		if err != nil {
			logrus.WithError(err).Error("Failed to create task")
			failedTasks++
			continue
		}

		// ТЕСТ: Отключаем задержки - все задачи сразу в очередь для максимальной скорости
		// delay := time.Duration(i) * time.Second / time.Duration(req.RateLimit)
		delay := time.Duration(0) // Все задачи без задержки!

		// Отправляем задачу в изолированную очередь воркера
		info, err := h.client.Enqueue(task, asynq.Queue(queueName), asynq.ProcessIn(delay))
		if err != nil {
			logrus.WithError(err).Error("Failed to enqueue task")
			failedTasks++
			continue
		}

		if i%100 == 0 { // Логируем каждые 100 задач
			logrus.WithFields(logrus.Fields{
				"mailing_id": req.MailingID,
				"task_id":    info.ID,
				"user_index": i + 1,
				"queue_name": queueName,
				"delay":      delay.String(),
			}).Debug("Task enqueued to dedicated worker")
		}

		totalTasks++
	}

	logrus.WithFields(logrus.Fields{
		"mailing_id":   req.MailingID,
		"worker_pid":   worker.ProcessID,
		"queue_name":   queueName,
		"total_tasks":  totalTasks,
		"failed_tasks": failedTasks,
	}).Info("Mailing tasks created for dedicated worker")

	c.JSON(http.StatusOK, gin.H{
		"message":      "Mailing created with dedicated worker",
		"mailing_id":   req.MailingID,
		"worker_pid":   worker.ProcessID,
		"queue_name":   queueName,
		"total_users":  len(users),
		"total_tasks":  totalTasks,
		"failed_tasks": failedTasks,
		"rate_limit":   req.RateLimit,
	})
}

// GetMailingStatus возвращает статус рассылки
func (h *MailingHandler) GetMailingStatus(c *gin.Context) {
	mailingID := c.Param("id")

	// Здесь можно добавить логику получения статуса из Redis или БД
	// Пока возвращаем базовую информацию
	c.JSON(http.StatusOK, gin.H{
		"mailing_id": mailingID,
		"status":     "processing",
		"message":    "Status tracking will be implemented in future versions",
	})
}

// HealthCheck проверка здоровья сервиса
func (h *MailingHandler) HealthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"timestamp": time.Now().UTC(),
		"version":   "1.0.0",
	})
}

// GetMailingMetrics возвращает метрики рассылки
func (h *MailingHandler) GetMailingMetrics(c *gin.Context) {
	mailingID := c.Param("id")

	metrics, err := h.metricsTracker.GetMailingMetrics(c.Request.Context(), mailingID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "Metrics not found",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, metrics)
}

// GetAllMailingMetrics возвращает метрики всех рассылок
func (h *MailingHandler) GetAllMailingMetrics(c *gin.Context) {
	allMetrics, err := h.metricsTracker.GetAllMailingMetrics(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to get metrics",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, allMetrics)
}

// loadUsersFromFile загружает пользователей из файла
func loadUsersFromFile(fileURL string) ([]models.User, error) {
	localPath, err := utils.DownloadAudience(fileURL)
	if err != nil {
		return nil, err
	}
	defer os.Remove(localPath)
	file, err := os.Open(localPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open audience file: %w", err)
	}
	defer file.Close()

	var users []models.User
	scanner := bufio.NewScanner(file)
	var scanErr error

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		re := regexp.MustCompile(`\d{6,12}(:[a-zA-Z]{2})?`)
		matches := re.FindAllString(line, -1)
		for _, match := range matches {
			idAndLang := strings.SplitN(match, ":", 2)
			userID := idAndLang[0]
			var lang string
			if len(idAndLang) > 1 {
				lang = idAndLang[1]
			}
			if len(userID) < 6 || len(userID) > 12 {
				logrus.WithField("user_id", userID).Warn("Invalid Telegram ID length, skipping")
				continue
			}
			users = append(users, models.User{
				UserID:   userID,
				Language: lang,
			})
		}
	}
	scanErr = scanner.Err()

	// Если ошибка bufio.Scanner: token too long, читаем весь файл как одну строку
	if scanErr != nil && strings.Contains(scanErr.Error(), "token too long") {
		logrus.Warn("Scanner token too long, fallback to reading entire file as one string")
		file.Seek(0, 0) // Сброс позиции
		reader := bufio.NewReader(file)
		content, err := reader.ReadString(0)
		if err != nil && err != io.EOF {
			return nil, fmt.Errorf("error reading file: %w", err)
		}
		re := regexp.MustCompile(`\d{6,12}(:[a-zA-Z]{2})?`)
		matches := re.FindAllString(content, -1)
		for _, match := range matches {
			idAndLang := strings.SplitN(match, ":", 2)
			userID := idAndLang[0]
			var lang string
			if len(idAndLang) > 1 {
				lang = idAndLang[1]
			}
			if len(userID) < 6 || len(userID) > 12 {
				logrus.WithField("user_id", userID).Warn("Invalid Telegram ID length, skipping")
				continue
			}
			users = append(users, models.User{
				UserID:   userID,
				Language: lang,
			})
		}
	} else if scanErr != nil {
		return nil, fmt.Errorf("error reading file: %w", scanErr)
	}

	return users, nil
}

// isDigits проверяет, что строка состоит только из цифр
func isDigits(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
