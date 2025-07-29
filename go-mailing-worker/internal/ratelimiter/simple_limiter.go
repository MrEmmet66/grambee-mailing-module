package ratelimiter

import (
	"sync"
	"time"

	"github.com/sirupsen/logrus"
)

// SimpleSleepRateLimiter простой rate limiter на основе sleep между отправками
type SimpleSleepRateLimiter struct {
	mutex           sync.Mutex
	currentRate     float64   // текущая скорость (сообщений/сек)
	maxRate         float64   // максимальная скорость (сообщений/сек)
	minRate         float64   // минимальная скорость (сообщений/сек)
	lastSendTime    time.Time // время последней отправки
	mailingID       string    // ID рассылки для логирования
	successCount    int       // количество успешных отправок подряд
	totalProcessed  int       // общее количество обработанных сообщений
	startTime       time.Time // время начала рассылки
	floodWaitCount  int       // количество FLOOD_WAIT ошибок
}

// NewSimpleSleepRateLimiter создает новый простой rate limiter
func NewSimpleSleepRateLimiter(mailingID string) *SimpleSleepRateLimiter {
	now := time.Now()
	initialRate := 25.0

	limiter := &SimpleSleepRateLimiter{
		currentRate:    initialRate,
		maxRate:        60.0,
		minRate:        15.0,
		lastSendTime:   now,
		mailingID:      mailingID,
		successCount:   0,
		totalProcessed: 0,
		startTime:      now,
		floodWaitCount: 0,
	}

	logrus.WithFields(logrus.Fields{
		"mailing_id":   mailingID,
		"initial_rate": initialRate,
		"max_rate":     limiter.maxRate,
		"type":         "SimpleSleepRateLimiter",
	}).Info("Created SimpleSleepRateLimiter instance")

	return limiter
}

// Wait ожидает необходимое время между отправками
func (srl *SimpleSleepRateLimiter) Wait() {
	srl.mutex.Lock()
	defer srl.mutex.Unlock()

	now := time.Now()
	
	// Вычисляем минимальный интервал между отправками
	minInterval := time.Duration(float64(time.Second) / srl.currentRate)
	
	// Вычисляем сколько времени прошло с последней отправки
	elapsed := now.Sub(srl.lastSendTime)
	
	// Если прошло меньше минимального интервала - ждем
	if elapsed < minInterval {
		sleepTime := minInterval - elapsed
		time.Sleep(sleepTime)
	}
	
	// Обновляем время последней отправки
	srl.lastSendTime = time.Now()
}

// OnProcessed вызывается при обработке любого сообщения
func (srl *SimpleSleepRateLimiter) OnProcessed() {
	srl.mutex.Lock()
	defer srl.mutex.Unlock()

	srl.successCount++
	srl.totalProcessed++

	// Вычисляем фактическую скорость
	elapsed := time.Since(srl.startTime).Seconds()
	actualRate := float64(srl.totalProcessed) / elapsed

	// Увеличиваем скорость каждые 100 обработанных сообщений
	if srl.successCount >= 100 {
		oldRate := srl.currentRate
		srl.currentRate = minFloat(srl.currentRate+2.0, srl.maxRate)

		if srl.currentRate != oldRate {
			logrus.WithFields(logrus.Fields{
				"mailing_id":      srl.mailingID,
				"old_rate":        oldRate,
				"new_rate":        srl.currentRate,
				"total_processed": srl.totalProcessed,
				"actual_rate":     actualRate,
				"flood_count":     srl.floodWaitCount,
				"max_rate":        srl.maxRate,
				"elapsed_sec":     elapsed,
			}).Info("Simple rate increased due to processed messages")
		}

		srl.successCount = 0 // сбрасываем счетчик
	}

	// Логируем каждые 50 обработанных сообщений
	if srl.totalProcessed%50 == 0 {
		logrus.WithFields(logrus.Fields{
			"mailing_id":      srl.mailingID,
			"total_processed": srl.totalProcessed,
			"current_rate":    srl.currentRate,
			"actual_rate":     actualRate,
			"max_rate":        srl.maxRate,
			"flood_count":     srl.floodWaitCount,
			"elapsed_sec":     elapsed,
		}).Info("Simple rate limiter progress update")
	}
}

// OnFloodWait вызывается при получении FLOOD_WAIT ошибки
func (srl *SimpleSleepRateLimiter) OnFloodWait(waitSeconds int) {
	srl.mutex.Lock()
	defer srl.mutex.Unlock()

	srl.floodWaitCount++
	srl.successCount = 0

	oldRate := srl.currentRate
	oldMaxRate := srl.maxRate

	// Резко снижаем скорость
	srl.currentRate = maxFloat(srl.currentRate-5.0, srl.minRate)
	srl.maxRate = maxFloat(srl.maxRate-2.0, srl.minRate+5.0)

	logrus.WithFields(logrus.Fields{
		"mailing_id":         srl.mailingID,
		"flood_wait_seconds": waitSeconds,
		"flood_count":        srl.floodWaitCount,
		"old_rate":           oldRate,
		"new_rate":           srl.currentRate,
		"old_max_rate":       oldMaxRate,
		"new_max_rate":       srl.maxRate,
	}).Warn("Simple rate decreased due to FLOOD_WAIT")
}

// GetCurrentRate возвращает текущую скорость
func (srl *SimpleSleepRateLimiter) GetCurrentRate() float64 {
	srl.mutex.Lock()
	defer srl.mutex.Unlock()
	return srl.currentRate
}

// GetMaxRate возвращает максимальную скорость
func (srl *SimpleSleepRateLimiter) GetMaxRate() float64 {
	srl.mutex.Lock()
	defer srl.mutex.Unlock()
	return srl.maxRate
}

// GetActualRate возвращает фактическую скорость обработки
func (srl *SimpleSleepRateLimiter) GetActualRate() float64 {
	srl.mutex.Lock()
	defer srl.mutex.Unlock()
	
	elapsed := time.Since(srl.startTime).Seconds()
	if elapsed <= 0 {
		return 0
	}
	return float64(srl.totalProcessed) / elapsed
}

// GetStats возвращает статистику rate limiter
func (srl *SimpleSleepRateLimiter) GetStats() map[string]interface{} {
	srl.mutex.Lock()
	defer srl.mutex.Unlock()

	elapsed := time.Since(srl.startTime).Seconds()
	actualRate := float64(srl.totalProcessed) / elapsed

	return map[string]interface{}{
		"current_rate":    srl.currentRate,
		"max_rate":        srl.maxRate,
		"min_rate":        srl.minRate,
		"flood_wait_count": srl.floodWaitCount,
		"total_processed": srl.totalProcessed,
		"actual_rate":     actualRate,
		"elapsed_seconds": elapsed,
		"type":            "SimpleSleepRateLimiter",
	}
}

// minFloat возвращает минимальное из двух значений
func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// maxFloat возвращает максимальное из двух значений
func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
