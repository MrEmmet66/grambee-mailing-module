package ratelimiter

import (
	"sync"
	"time"

	"github.com/sirupsen/logrus"
)

// ConcurrentRateLimiter позволяет нескольким горутинам работать параллельно с rate limiting
type ConcurrentRateLimiter struct {
	mutex           sync.Mutex
	currentRate     float64     // текущая скорость (сообщений/сек)
	maxRate         float64     // максимальная скорость (сообщений/сек)
	minRate         float64     // минимальная скорость (сообщений/сек)
	tokens          float64     // доступные токены
	lastRefill      time.Time   // время последнего пополнения токенов
	mailingID       string      // ID рассылки для логирования
	successCount    int         // количество успешных отправок подряд
	totalProcessed  int         // общее количество обработанных сообщений
	startTime       time.Time   // время начала рассылки
	floodWaitCount  int         // количество FLOOD_WAIT ошибок
	concurrency     int         // количество одновременных горутин
}

// NewConcurrentRateLimiter создает новый concurrent rate limiter
func NewConcurrentRateLimiter(mailingID string, concurrency int) *ConcurrentRateLimiter {
	now := time.Now()
	initialRate := 25.0

	limiter := &ConcurrentRateLimiter{
		currentRate:    initialRate,
		maxRate:        60.0,
		minRate:        15.0,
		tokens:         initialRate, // Начинаем с полным ведром токенов
		lastRefill:     now,
		mailingID:      mailingID,
		successCount:   0,
		totalProcessed: 0,
		startTime:      now,
		floodWaitCount: 0,
		concurrency:    concurrency,
	}

	logrus.WithFields(logrus.Fields{
		"mailing_id":   mailingID,
		"initial_rate": initialRate,
		"max_rate":     limiter.maxRate,
		"concurrency":  concurrency,
		"type":         "ConcurrentRateLimiter",
	}).Info("Created ConcurrentRateLimiter instance")

	return limiter
}

// Wait ожидает получения токена для отправки
func (crl *ConcurrentRateLimiter) Wait() {
	for {
		crl.mutex.Lock()
		
		now := time.Now()
		
		// Пополняем токены на основе времени
		elapsed := now.Sub(crl.lastRefill).Seconds()
		if elapsed > 0 {
			// Добавляем токены со скоростью currentRate в секунду
			tokensToAdd := crl.currentRate * elapsed
			crl.tokens += tokensToAdd
			
			// Ограничиваем максимальное количество токенов (burst capacity)
			maxTokens := crl.currentRate * 2.0 // Burst на 2 секунды
			if crl.tokens > maxTokens {
				crl.tokens = maxTokens
			}
			
			crl.lastRefill = now
		}

		// Если есть токены - берем один и идем дальше
		if crl.tokens >= 1.0 {
			crl.tokens -= 1.0
			crl.mutex.Unlock()
			return
		}
		
		// Если токенов нет - отпускаем mutex и ждем немного
		crl.mutex.Unlock()
		
		// Короткое ожидание перед повторной проверкой
		time.Sleep(10 * time.Millisecond)
	}
}

// OnProcessed вызывается при обработке любого сообщения
func (crl *ConcurrentRateLimiter) OnProcessed() {
	crl.mutex.Lock()
	defer crl.mutex.Unlock()

	crl.successCount++
	crl.totalProcessed++

	// Вычисляем фактическую скорость
	elapsed := time.Since(crl.startTime).Seconds()
	actualRate := float64(crl.totalProcessed) / elapsed

	// Увеличиваем скорость каждые 100 обработанных сообщений
	if crl.successCount >= 100 {
		oldRate := crl.currentRate
		crl.currentRate = minFloat(crl.currentRate+2.0, crl.maxRate)

		if crl.currentRate != oldRate {
			logrus.WithFields(logrus.Fields{
				"mailing_id":      crl.mailingID,
				"old_rate":        oldRate,
				"new_rate":        crl.currentRate,
				"total_processed": crl.totalProcessed,
				"actual_rate":     actualRate,
				"flood_count":     crl.floodWaitCount,
				"max_rate":        crl.maxRate,
				"elapsed_sec":     elapsed,
				"concurrency":     crl.concurrency,
				"tokens":          crl.tokens,
			}).Info("Concurrent rate increased due to processed messages")
		}

		crl.successCount = 0 // сбрасываем счетчик
	}

	// Логируем каждые 50 обработанных сообщений
	if crl.totalProcessed%50 == 0 {
		logrus.WithFields(logrus.Fields{
			"mailing_id":      crl.mailingID,
			"total_processed": crl.totalProcessed,
			"current_rate":    crl.currentRate,
			"actual_rate":     actualRate,
			"max_rate":        crl.maxRate,
			"flood_count":     crl.floodWaitCount,
			"elapsed_sec":     elapsed,
			"concurrency":     crl.concurrency,
			"tokens":          crl.tokens,
		}).Info("Concurrent rate limiter progress update")
	}
}

// OnFloodWait вызывается при получении FLOOD_WAIT ошибки
func (crl *ConcurrentRateLimiter) OnFloodWait(waitSeconds int) {
	crl.mutex.Lock()
	defer crl.mutex.Unlock()

	crl.floodWaitCount++
	crl.successCount = 0

	oldRate := crl.currentRate
	oldMaxRate := crl.maxRate

	// Резко снижаем скорость
	crl.currentRate = maxFloat(crl.currentRate-5.0, crl.minRate)
	crl.maxRate = maxFloat(crl.maxRate-2.0, crl.minRate+5.0)
	
	// Обнуляем токены после FLOOD_WAIT
	crl.tokens = 0

	logrus.WithFields(logrus.Fields{
		"mailing_id":         crl.mailingID,
		"flood_wait_seconds": waitSeconds,
		"flood_count":        crl.floodWaitCount,
		"old_rate":           oldRate,
		"new_rate":           crl.currentRate,
		"old_max_rate":       oldMaxRate,
		"new_max_rate":       crl.maxRate,
		"concurrency":        crl.concurrency,
	}).Warn("Concurrent rate decreased due to FLOOD_WAIT")
}

// GetCurrentRate возвращает текущую скорость
func (crl *ConcurrentRateLimiter) GetCurrentRate() float64 {
	crl.mutex.Lock()
	defer crl.mutex.Unlock()
	return crl.currentRate
}

// GetMaxRate возвращает максимальную скорость
func (crl *ConcurrentRateLimiter) GetMaxRate() float64 {
	crl.mutex.Lock()
	defer crl.mutex.Unlock()
	return crl.maxRate
}

// GetActualRate возвращает фактическую скорость обработки
func (crl *ConcurrentRateLimiter) GetActualRate() float64 {
	crl.mutex.Lock()
	defer crl.mutex.Unlock()
	
	elapsed := time.Since(crl.startTime).Seconds()
	if elapsed <= 0 {
		return 0
	}
	return float64(crl.totalProcessed) / elapsed
}

// GetStats возвращает статистику rate limiter
func (crl *ConcurrentRateLimiter) GetStats() map[string]interface{} {
	crl.mutex.Lock()
	defer crl.mutex.Unlock()

	elapsed := time.Since(crl.startTime).Seconds()
	actualRate := float64(crl.totalProcessed) / elapsed

	return map[string]interface{}{
		"current_rate":     crl.currentRate,
		"max_rate":         crl.maxRate,
		"min_rate":         crl.minRate,
		"flood_wait_count": crl.floodWaitCount,
		"total_processed":  crl.totalProcessed,
		"actual_rate":      actualRate,
		"elapsed_seconds":  elapsed,
		"concurrency":      crl.concurrency,
		"tokens":           crl.tokens,
		"type":             "ConcurrentRateLimiter",
	}
}
