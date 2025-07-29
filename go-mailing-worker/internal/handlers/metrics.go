package handlers

import (
	"context"
	"net/http"

	"go-mailing-worker/internal/metrics"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// MetricsHandler Gin-хендлер для метрик рассылок
type MetricsHandler struct {
	tracker *metrics.MetricsTracker
}

// NewMetricsHandler конструктор
func NewMetricsHandler(tracker *metrics.MetricsTracker) *MetricsHandler {
	return &MetricsHandler{tracker: tracker}
}

// GetMailingMetrics возвращает метрики по конкретной рассылке
func (h *MetricsHandler) GetMailingMetrics(c *gin.Context) {
	mailingID := c.Param("id")
	ctx := context.Background()

	logrus.WithField("mailing_id", mailingID).Debug("Requesting metrics for mailing")

	metrics, err := h.tracker.GetMailingMetrics(ctx, mailingID)
	if err != nil {
		logrus.WithError(err).WithField("mailing_id", mailingID).Warn("Failed to get mailing metrics")
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "Metrics not found",
			"details": err.Error(),
		})
		return
	}

	logrus.WithField("mailing_id", mailingID).Debug("Successfully retrieved metrics")
	c.JSON(http.StatusOK, metrics)
}

// GetAllMailingMetrics возвращает метрики всех рассылок
func (h *MetricsHandler) GetAllMailingMetrics(c *gin.Context) {
	ctx := context.Background()
	allMetrics, err := h.tracker.GetAllMailingMetrics(ctx)
	if err != nil {
		logrus.WithError(err).Error("Failed to get all mailing metrics")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to get metrics",
			"details": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"metrics": allMetrics, "total": len(allMetrics)})
}
