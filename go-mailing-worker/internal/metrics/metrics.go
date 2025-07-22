package metrics

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"
)

// MetricsTracker отслеживает метрики рассылок
type MetricsTracker struct {
	redisClient *redis.Client
}

// MailingMetrics метрики рассылки
type MailingMetrics struct {
	MailingID       string    `json:"mailing_id"`
	TotalMessages   int       `json:"total_messages"`
	SentMessages    int       `json:"sent_messages"`
	FailedMessages  int       `json:"failed_messages"`
	StartTime       time.Time `json:"start_time"`
	LastUpdateTime  time.Time `json:"last_update_time"`
	MessagesPerSec  float64   `json:"messages_per_sec"`
	AvgResponseTime int64     `json:"avg_response_time_ms"`
	FloodWaitCount  int       `json:"flood_wait_count"`
	TotalFloodWait  int64     `json:"total_flood_wait_sec"`
}

// NewMetricsTracker создает новый трекер метрик
func NewMetricsTracker(redisClient *redis.Client) *MetricsTracker {
	return &MetricsTracker{
		redisClient: redisClient,
	}
}

// InitMailingMetrics инициализирует метрики для новой рассылки
func (m *MetricsTracker) InitMailingMetrics(ctx context.Context, mailingID string, totalMessages int) error {
	metrics := MailingMetrics{
		MailingID:       mailingID,
		TotalMessages:   totalMessages,
		SentMessages:    0,
		FailedMessages:  0,
		StartTime:       time.Now(),
		LastUpdateTime:  time.Now(),
		MessagesPerSec:  0,
		AvgResponseTime: 0,
		FloodWaitCount:  0,
		TotalFloodWait:  0,
	}

	data, err := json.Marshal(metrics)
	if err != nil {
		return err
	}

	key := fmt.Sprintf("mailing_metrics:%s", mailingID)
	return m.redisClient.Set(ctx, key, data, 24*time.Hour).Err()
}

// UpdateMessageSent обновляет счетчик отправленных сообщений
func (m *MetricsTracker) UpdateMessageSent(ctx context.Context, mailingID string, responseTimeMs int64) error {
	return m.updateMetrics(ctx, mailingID, func(metrics *MailingMetrics) {
		metrics.SentMessages++
		metrics.LastUpdateTime = time.Now()

		// Обновляем среднее время ответа
		if metrics.SentMessages == 1 {
			metrics.AvgResponseTime = responseTimeMs
		} else {
			metrics.AvgResponseTime = (metrics.AvgResponseTime + responseTimeMs) / 2
		}

		// Пересчитываем скорость отправки
		duration := metrics.LastUpdateTime.Sub(metrics.StartTime).Seconds()
		if duration > 0 {
			metrics.MessagesPerSec = float64(metrics.SentMessages) / duration
		}
	})
}

// UpdateMessageFailed обновляет счетчик неудачных сообщений
func (m *MetricsTracker) UpdateMessageFailed(ctx context.Context, mailingID string) error {
	return m.updateMetrics(ctx, mailingID, func(metrics *MailingMetrics) {
		metrics.FailedMessages++
		metrics.LastUpdateTime = time.Now()
	})
}

// UpdateFloodWait обновляет статистику флуд-вейтов
func (m *MetricsTracker) UpdateFloodWait(ctx context.Context, mailingID string, waitTimeSeconds int) error {
	return m.updateMetrics(ctx, mailingID, func(metrics *MailingMetrics) {
		metrics.FloodWaitCount++
		metrics.TotalFloodWait += int64(waitTimeSeconds)
		metrics.LastUpdateTime = time.Now()
	})
}

// GetMailingMetrics получает метрики рассылки
func (m *MetricsTracker) GetMailingMetrics(ctx context.Context, mailingID string) (*MailingMetrics, error) {
	key := fmt.Sprintf("mailing_metrics:%s", mailingID)
	data, err := m.redisClient.Get(ctx, key).Result()
	if err != nil {
		if err == redis.Nil {
			return nil, fmt.Errorf("metrics not found for mailing %s", mailingID)
		}
		return nil, err
	}

	var metrics MailingMetrics
	err = json.Unmarshal([]byte(data), &metrics)
	if err != nil {
		return nil, err
	}

	return &metrics, nil
}

// GetAllMailingMetrics получает метрики всех активных рассылок
func (m *MetricsTracker) GetAllMailingMetrics(ctx context.Context) (map[string]*MailingMetrics, error) {
	keys, err := m.redisClient.Keys(ctx, "mailing_metrics:*").Result()
	if err != nil {
		return nil, err
	}

	result := make(map[string]*MailingMetrics)
	for _, key := range keys {
		data, err := m.redisClient.Get(ctx, key).Result()
		if err != nil {
			logrus.WithError(err).WithField("key", key).Warn("Failed to get metrics")
			continue
		}

		var metrics MailingMetrics
		if err := json.Unmarshal([]byte(data), &metrics); err != nil {
			logrus.WithError(err).WithField("key", key).Warn("Failed to unmarshal metrics")
			continue
		}

		result[metrics.MailingID] = &metrics
	}

	return result, nil
}

// updateMetrics обновляет метрики с использованием функции-модификатора
func (m *MetricsTracker) updateMetrics(ctx context.Context, mailingID string, updateFunc func(*MailingMetrics)) error {
	key := fmt.Sprintf("mailing_metrics:%s", mailingID)

	// Используем транзакцию для атомарного обновления
	err := m.redisClient.Watch(ctx, func(tx *redis.Tx) error {
		data, err := tx.Get(ctx, key).Result()
		if err != nil && err != redis.Nil {
			return err
		}

		var metrics MailingMetrics
		if err == redis.Nil {
			// Метрики не найдены, создаем новые
			metrics = MailingMetrics{
				MailingID:      mailingID,
				StartTime:      time.Now(),
				LastUpdateTime: time.Now(),
			}
		} else {
			if err := json.Unmarshal([]byte(data), &metrics); err != nil {
				return err
			}
		}

		// Применяем обновление
		updateFunc(&metrics)

		// Сохраняем обновленные метрики
		updatedData, err := json.Marshal(metrics)
		if err != nil {
			return err
		}

		_, err = tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
			pipe.Set(ctx, key, updatedData, 24*time.Hour)
			return nil
		})
		return err
	}, key)

	return err
}

// CleanupOldMetrics очищает старые метрики
func (m *MetricsTracker) CleanupOldMetrics(ctx context.Context, olderThan time.Duration) error {
	keys, err := m.redisClient.Keys(ctx, "mailing_metrics:*").Result()
	if err != nil {
		return err
	}

	cutoff := time.Now().Add(-olderThan)

	for _, key := range keys {
		data, err := m.redisClient.Get(ctx, key).Result()
		if err != nil {
			continue
		}

		var metrics MailingMetrics
		if err := json.Unmarshal([]byte(data), &metrics); err != nil {
			continue
		}

		if metrics.LastUpdateTime.Before(cutoff) {
			m.redisClient.Del(ctx, key)
			logrus.WithField("mailing_id", metrics.MailingID).Info("Cleaned up old metrics")
		}
	}

	return nil
}
