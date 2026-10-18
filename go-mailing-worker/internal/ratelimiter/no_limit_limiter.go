package ratelimiter

import (
	"sync"
	"time"

	"github.com/sirupsen/logrus"
)

// NoLimitRateLimiter пропускает все запросы без ограничений для тестирования
type NoLimitRateLimiter struct {
	mutex          sync.Mutex
	mailingID      string
	totalProcessed int
	startTime      time.Time
	concurrency    int
}

// NewNoLimitRateLimiter создает rate limiter без ограничений
func NewNoLimitRateLimiter(mailingID string, concurrency int) *NoLimitRateLimiter {
	now := time.Now()

	limiter := &NoLimitRateLimiter{
		mailingID:      mailingID,
		totalProcessed: 0,
		startTime:      now,
		concurrency:    concurrency,
	}

	logrus.WithFields(logrus.Fields{
		"mailing_id":  mailingID,
		"concurrency": concurrency,
		"type":        "NoLimitRateLimiter",
	}).Info("Created NoLimitRateLimiter - NO RATE LIMITING!")

	return limiter
}

// Wait ничего не делает - пропускаем все без ограничений
func (nlrl *NoLimitRateLimiter) Wait() {
	// Ничего не делаем - полная скорость!
}

// OnProcessed считает обработанные сообщения
func (nlrl *NoLimitRateLimiter) OnProcessed() {
	nlrl.mutex.Lock()
	defer nlrl.mutex.Unlock()

	nlrl.totalProcessed++

	// Логируем каждые 50 обработанных сообщений
	if nlrl.totalProcessed%50 == 0 {
		elapsed := time.Since(nlrl.startTime).Seconds()
		actualRate := float64(nlrl.totalProcessed) / elapsed

		logrus.WithFields(logrus.Fields{
			"mailing_id":      nlrl.mailingID,
			"total_processed": nlrl.totalProcessed,
			"actual_rate":     actualRate,
			"elapsed_sec":     elapsed,
			"concurrency":     nlrl.concurrency,
			"type":            "NoLimit",
		}).Info("NO LIMIT rate limiter progress - FULL SPEED!")
	}
}

// OnFloodWait логирует флуд-вейт но не ограничивает скорость
func (nlrl *NoLimitRateLimiter) OnFloodWait(waitSeconds int) {
	nlrl.mutex.Lock()
	defer nlrl.mutex.Unlock()

	logrus.WithFields(logrus.Fields{
		"mailing_id":         nlrl.mailingID,
		"flood_wait_seconds": waitSeconds,
		"concurrency":        nlrl.concurrency,
	}).Warn("FLOOD_WAIT detected but NO RATE LIMITING applied!")
}

// GetCurrentRate возвращает "безлимитную" скорость
func (nlrl *NoLimitRateLimiter) GetCurrentRate() float64 {
	return 999.0 // Показываем что лимита нет
}

// GetMaxRate возвращает "безлимитную" скорость
func (nlrl *NoLimitRateLimiter) GetMaxRate() float64 {
	return 999.0 // Показываем что лимита нет
}

// GetActualRate возвращает фактическую скорость
func (nlrl *NoLimitRateLimiter) GetActualRate() float64 {
	nlrl.mutex.Lock()
	defer nlrl.mutex.Unlock()
	
	elapsed := time.Since(nlrl.startTime).Seconds()
	if elapsed <= 0 {
		return 0
	}
	return float64(nlrl.totalProcessed) / elapsed
}

// GetStats возвращает статистику
func (nlrl *NoLimitRateLimiter) GetStats() map[string]interface{} {
	nlrl.mutex.Lock()
	defer nlrl.mutex.Unlock()

	elapsed := time.Since(nlrl.startTime).Seconds()
	actualRate := float64(nlrl.totalProcessed) / elapsed

	return map[string]interface{}{
		"current_rate":     999.0,
		"max_rate":         999.0,
		"min_rate":         0.0,
		"flood_wait_count": 0,
		"total_processed":  nlrl.totalProcessed,
		"actual_rate":      actualRate,
		"elapsed_seconds":  elapsed,
		"concurrency":      nlrl.concurrency,
		"type":             "NoLimitRateLimiter",
	}
}
