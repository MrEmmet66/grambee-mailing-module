package metrics

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"
)

// MetricsTracker отслеживает метрики рассылок
type MetricsTracker struct {
	redisClient *redis.Client
}

// AsynqQueueStats статистика очереди из asynq
type AsynqQueueStats struct {
	Size      int `json:"size"`      // размер очереди (pending)
	Processed int `json:"processed"` // успешно обработанные
	Failed    int `json:"failed"`    // неудачные (доставка не удалась)
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
	CurrentRate     float64   `json:"current_rate"` // текущая скорость rate limiter
	MaxRate         float64   `json:"max_rate"`     // максимальная скорость rate limiter
}

// NewMetricsTracker создает новый трекер метрик
func NewMetricsTracker(redisClient *redis.Client) *MetricsTracker {
	return &MetricsTracker{
		redisClient: redisClient,
	}
}

// GetAsynqQueueStats получает статистику очереди из asynq
func (m *MetricsTracker) GetAsynqQueueStats(ctx context.Context, queueName string) (*AsynqQueueStats, error) {
	inspector := asynq.NewInspector(asynq.RedisClientOpt{
		Addr:     m.redisClient.Options().Addr,
		Password: m.redisClient.Options().Password,
		DB:       m.redisClient.Options().DB,
	})
	defer inspector.Close()

	queueInfo, err := inspector.GetQueueInfo(queueName)
	if err != nil {
		return nil, fmt.Errorf("failed to get queue info: %w", err)
	}

	return &AsynqQueueStats{
		Size:      queueInfo.Size,
		Processed: queueInfo.Processed,
		Failed:    queueInfo.Failed,
	}, nil
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
		CurrentRate:     25.0, // начальная скорость rate limiter
		MaxRate:         60.0, // максимальная скорость rate limiter
	}

	data, err := json.Marshal(metrics)
	if err != nil {
		return err
	}

	key := fmt.Sprintf("mailing_metrics:%s", mailingID)
	return m.redisClient.Set(ctx, key, data, 24*time.Hour).Err()
}

// UpdateMessageSent обновляет счетчик отправленных сообщений (УДАЛЕНО - теперь берем из asynq)
// DEPRECATED: Этот метод больше не используется, данные берутся из asynq

// UpdateMessageFailed обновляет счетчик неудачных сообщений (УДАЛЕНО - теперь берем из asynq)
// DEPRECATED: Этот метод больше не используется, данные берутся из asynq

// UpdateResponseTime обновляет среднее время ответа
func (m *MetricsTracker) UpdateResponseTime(ctx context.Context, mailingID string, responseTimeMs int64) error {
	return m.updateMetrics(ctx, mailingID, func(metrics *MailingMetrics) {
		metrics.LastUpdateTime = time.Now()
		// Обновляем среднее время ответа (скользящее среднее)
		if metrics.AvgResponseTime == 0 {
			metrics.AvgResponseTime = responseTimeMs
		} else {
			// Скользящее среднее: новое значение получает вес 0.1, старое 0.9
			metrics.AvgResponseTime = int64(float64(metrics.AvgResponseTime)*0.9 + float64(responseTimeMs)*0.1)
		}
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

// UpdateRateLimiter обновляет информацию о rate limiter в метриках
func (m *MetricsTracker) UpdateRateLimiter(ctx context.Context, mailingID string, currentRate, maxRate float64) error {
	return m.updateMetrics(ctx, mailingID, func(metrics *MailingMetrics) {
		metrics.CurrentRate = currentRate
		metrics.MaxRate = maxRate
		metrics.LastUpdateTime = time.Now()
	})
}

// GetMailingMetrics получает метрики рассылки
func (m *MetricsTracker) GetMailingMetrics(ctx context.Context, mailingID string) (*MailingMetrics, error) {
	// Сначала пробуем найти по точному ключу
	key := fmt.Sprintf("mailing_metrics:%s", mailingID)
	data, err := m.redisClient.Get(ctx, key).Result()
	if err == nil {
		var metrics MailingMetrics
		err = json.Unmarshal([]byte(data), &metrics)
		if err != nil {
			return nil, err
		}

		// НОВОЕ: Получаем актуальные данные из asynq
		queueName := fmt.Sprintf("mailing_%s", mailingID)
		asynqStats, err := m.GetAsynqQueueStats(ctx, queueName)
		if err != nil {
			logrus.WithError(err).WithField("queue_name", queueName).Warn("Failed to get asynq stats, using stored values")
		} else {
			// Заменяем счетчики данными из asynq
			metrics.SentMessages = asynqStats.Processed - asynqStats.Failed
			metrics.FailedMessages = asynqStats.Failed

			// Рассчитываем актуальную скорость (messages per sec)
			duration := time.Since(metrics.StartTime).Seconds()
			totalProcessed := metrics.SentMessages + metrics.FailedMessages
			if duration > 0 {
				metrics.MessagesPerSec = float64(totalProcessed) / duration
			}
		}

		return &metrics, nil
	}

	// Если не найдено, ищем по паттерну (для поддержки составных ключей)
	if err == redis.Nil {
		pattern := fmt.Sprintf("mailing_metrics:*_%s", mailingID)
		keys, err := m.redisClient.Keys(ctx, pattern).Result()
		if err != nil {
			return nil, err
		}

		if len(keys) == 0 {
			return nil, fmt.Errorf("metrics not found for mailing %s", mailingID)
		}

		// Берем первый найденный ключ (должен быть только один)
		data, err := m.redisClient.Get(ctx, keys[0]).Result()
		if err != nil {
			return nil, err
		}

		var metrics MailingMetrics
		err = json.Unmarshal([]byte(data), &metrics)
		if err != nil {
			return nil, err
		}

		// НОВОЕ: Получаем актуальные данные из asynq для составного ключа
		queueName := fmt.Sprintf("mailing_%s", mailingID)
		asynqStats, err := m.GetAsynqQueueStats(ctx, queueName)
		if err != nil {
			logrus.WithError(err).WithField("queue_name", queueName).Warn("Failed to get asynq stats, using stored values")
		} else {
			// Заменяем счетчики данными из asynq
			metrics.SentMessages = asynqStats.Processed
			metrics.FailedMessages = asynqStats.Failed

			// Рассчитываем актуальную скорость (messages per sec)
			duration := time.Since(metrics.StartTime).Seconds()
			totalProcessed := metrics.SentMessages + metrics.FailedMessages
			if duration > 0 {
				metrics.MessagesPerSec = float64(totalProcessed) / duration
			}
		}

		return &metrics, nil
	}

	return nil, err
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

		// НОВОЕ: Получаем актуальные данные из asynq для каждой рассылки
		queueName := fmt.Sprintf("mailing_%s", metrics.MailingID)
		asynqStats, err := m.GetAsynqQueueStats(ctx, queueName)
		if err != nil {
			logrus.WithError(err).WithField("queue_name", queueName).Debug("Failed to get asynq stats, using stored values")
		} else {
			// Заменяем счетчики данными из asynq
			metrics.SentMessages = asynqStats.Processed
			metrics.FailedMessages = asynqStats.Failed

			// Рассчитываем актуальную скорость (messages per sec)
			duration := time.Since(metrics.StartTime).Seconds()
			totalProcessed := metrics.SentMessages + metrics.FailedMessages
			if duration > 0 {
				metrics.MessagesPerSec = float64(totalProcessed) / duration
			}
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
