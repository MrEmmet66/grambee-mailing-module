package handlers

import (
	"bufio"
	"fmt"
	"net/http"
	"os"
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

		// Добавляем задержку на основе rate limit
		delay := time.Duration(i) * time.Second / time.Duration(req.RateLimit)

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
	// Проверяем, является ли это локальным файлом или URL
	var file *os.File

	if strings.HasPrefix(fileURL, "http://") || strings.HasPrefix(fileURL, "https://") {
		// Скачиваем файл, если это абсолютный URL
		localPath, err := utils.DownloadFile(fileURL)
		if err != nil {
			return nil, fmt.Errorf("failed to download file: %w", err)
		}
		defer os.Remove(localPath)
		file, err = os.Open(localPath)
		if err != nil {
			return nil, fmt.Errorf("failed to open downloaded file: %w", err)
		}
	} else {
		// Формируем абсолютный URL для относительного пути
		mainServiceURL := os.Getenv("MAIN_SERVICE_URL")
		if mainServiceURL == "" {
			mainServiceURL = "http://localhost:3000"
		}
		// Удаляем завершающий слэш у mainServiceURL
		mainServiceURL = strings.TrimRight(mainServiceURL, "/")
		// Удаляем начальный слэш у fileURL
		relPath := strings.TrimLeft(fileURL, "/")
		fullURL := mainServiceURL + "/" + relPath
		logrus.WithField("full_url", fullURL).Info("Converting relative path to full URL")
		localPath, err := utils.DownloadFile(fullURL)
		if err != nil {
			return nil, fmt.Errorf("failed to download file from %s: %w", fullURL, err)
		}
		defer os.Remove(localPath)
		file, err = os.Open(localPath)
		if err != nil {
			return nil, fmt.Errorf("failed to open downloaded file: %w", err)
		}
	}
	defer file.Close()

	var users []models.User
	scanner := bufio.NewScanner(file)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		// Поддерживаем форматы:
		// 123456789
		// 123456789:en
		parts := strings.Split(line, ":")

		user := models.User{
			UserID: parts[0],
		}

		if len(parts) > 1 {
			user.Language = parts[1]
		}

		users = append(users, user)
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error reading file: %w", err)
	}

	return users, nil
}
