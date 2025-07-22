package handlers

import (
	"net/http"

	"go-mailing-worker/internal/manager"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// WorkerHandler содержит обработчики для управления воркерами
type WorkerHandler struct {
	workerManager *manager.WorkerManager
}

// NewWorkerHandler создает новый обработчик воркеров
func NewWorkerHandler(workerManager *manager.WorkerManager) *WorkerHandler {
	return &WorkerHandler{
		workerManager: workerManager,
	}
}

// StopWorker останавливает воркер по ID рассылки
func (h *WorkerHandler) StopWorker(c *gin.Context) {
	mailingID := c.Param("id")

	err := h.workerManager.StopWorker(mailingID)
	if err != nil {
		logrus.WithError(err).WithField("mailing_id", mailingID).Error("Failed to stop worker")
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "Failed to stop worker",
			"details": err.Error(),
		})
		return
	}

	logrus.WithField("mailing_id", mailingID).Info("Worker stop requested")
	c.JSON(http.StatusOK, gin.H{
		"message":    "Worker stop requested",
		"mailing_id": mailingID,
	})
}

// GetAllWorkers возвращает список всех воркеров
func (h *WorkerHandler) GetAllWorkers(c *gin.Context) {
	workers := h.workerManager.GetAllWorkers()

	// Преобразуем в более удобный формат для JSON
	result := make([]gin.H, 0, len(workers))
	for mailingID, worker := range workers {
		result = append(result, gin.H{
			"mailing_id":      mailingID,
			"queue_name":      worker.QueueName,
			"process_id":      worker.ProcessID,
			"status":          worker.Status,
			"started_at":      worker.StartedAt,
			"total_tasks":     worker.TotalTasks,
			"completed_tasks": worker.CompletedTasks,
			"failed_tasks":    worker.FailedTasks,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"workers": result,
		"total":   len(result),
	})
}

// GetWorkerStatus возвращает статус конкретного воркера
func (h *WorkerHandler) GetWorkerStatus(c *gin.Context) {
	mailingID := c.Param("id")

	worker, err := h.workerManager.GetWorkerStatus(mailingID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "Worker not found",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"mailing_id":      worker.MailingID,
		"queue_name":      worker.QueueName,
		"process_id":      worker.ProcessID,
		"status":          worker.Status,
		"started_at":      worker.StartedAt,
		"total_tasks":     worker.TotalTasks,
		"completed_tasks": worker.CompletedTasks,
		"failed_tasks":    worker.FailedTasks,
	})
}
