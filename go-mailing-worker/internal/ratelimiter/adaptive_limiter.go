package ratelimiter

import (
	"fmt"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
)

// AdaptiveRateLimiter адаптивный rate limiter для каждого воркера
type AdaptiveRateLimiter struct {
	mutex                 sync.RWMutex
	currentRate           float64   // текущая скорость (сообщений/сек)
	maxRate               float64   // максимальная скорость (сообщений/сек)
	minRate               float64   // минимальная скорость (сообщений/сек)
	initialRate           float64   // начальная скорость (сообщений/сек)
	lastSendTime          time.Time // время последней отправки
	floodWaitCount        int       // количество FLOOD_WAIT ошибок
	successCount          int       // количество успешных отправок подряд
	rateIncreaseStep      float64   // шаг увеличения скорости
	rateDecreaseStep      float64   // шаг уменьшения скорости
	mailingID             string    // ID рассылки для логирования
	rateIncreaseThreshold int       // порог для увеличения скорости
	// Добавляем поля для отслеживания фактической скорости
	startTime      time.Time // время начала рассылки
	totalProcessed int       // общее количество обработанных сообщений
	// Добавляем поля для токен-бакет подхода
	tokenBucket     float64   // текущее количество токенов
	lastTokenRefill time.Time // время последнего пополнения токенов
	// Добавляем поле для защиты от повторного FLOOD_WAIT
	lastFloodWaitTime time.Time // время последнего FLOOD_WAIT
}

// NewAdaptiveRateLimiter создает новый адаптивный rate limiter
func NewAdaptiveRateLimiter(mailingID string) *AdaptiveRateLimiter {
	now := time.Now()
	initialRate := 25.0

	limiter := &AdaptiveRateLimiter{
		currentRate:           initialRate, // начальная скорость 25 сообщений/сек
		maxRate:               60.0,        // максимальная скорость 60 сообщений/сек
		minRate:               15.0,        // минимальная скорость 15 сообщений/сек
		initialRate:           initialRate, // запоминаем начальную скорость
		lastSendTime:          now,
		floodWaitCount:        0,
		successCount:          0,
		rateIncreaseStep:      2.0, // увеличиваем на 2 сообщения/сек
		rateDecreaseStep:      5.0, // уменьшаем на 5 сообщений/сек при FLOOD_WAIT
		mailingID:             mailingID,
		rateIncreaseThreshold: 100, // увеличиваем скорость каждые 100 обработанных сообщений
		startTime:             now,
		totalProcessed:        0,
		// ИСПРАВЛЕНО: Инициализируем токен-бакет с разумным количеством
		tokenBucket:       1.0, // Начинаем с 1 токена, а не с initialRate!
		lastTokenRefill:   now,
		lastFloodWaitTime: time.Time{}, // Инициализируем нулевым значением
	}

	// Логируем создание rate limiter для подтверждения уникальности
	logrus.WithFields(logrus.Fields{
		"mailing_id":   mailingID,
		"initial_rate": initialRate,
		"max_rate":     limiter.maxRate,
		"limiter_addr": fmt.Sprintf("%p", limiter), // адрес в памяти для уникальности
		"start_time":   now.Format(time.RFC3339),
	}).Info("Created unique AdaptiveRateLimiter instance")

	return limiter
}

// Wait ожидает в соответствии с текущим rate limit используя токен-бакет
func (arl *AdaptiveRateLimiter) Wait() {
	waitCount := 0
	for {
		arl.mutex.Lock()

		now := time.Now()

		// Пополняем токены на основе прошедшего времени ТОЛЬКО ОДИН РАЗ
		elapsed := now.Sub(arl.lastTokenRefill).Seconds()
		if elapsed > 0.01 { // Минимум 10ms между пополнениями
			tokensToAdd := elapsed * arl.currentRate
			// КРИТИЧЕСКИ ВАЖНО: Ограничиваем максимум токенов!
			maxTokens := arl.currentRate // НЕ 2x, а просто currentRate
			arl.tokenBucket = min(arl.tokenBucket+tokensToAdd, maxTokens)
			arl.lastTokenRefill = now
		}

		// Если есть токен - берем его и выходим немедленно
		if arl.tokenBucket >= 1.0 {
			arl.tokenBucket -= 1.0

			// Диагностическое логирование если долго ждали
			if waitCount > 0 {
				logrus.WithFields(logrus.Fields{
					"mailing_id":   arl.mailingID,
					"wait_count":   waitCount,
					"current_rate": arl.currentRate,
					"token_bucket": arl.tokenBucket,
					"elapsed_ms":   elapsed * 1000,
					"limiter_addr": fmt.Sprintf("%p", arl),
				}).Debug("Wait() completed after cycles")
			}

			arl.mutex.Unlock()
			return // УСПЕШНО ПОЛУЧИЛИ ТОКЕН!
		}

		// Токенов нет - вычисляем время ожидания до следующего токена
		waitTime := time.Duration(float64(time.Second) / arl.currentRate)
		waitCount++

		// Диагностика при каждом 5-м ожидании
		if waitCount%5 == 0 {
			logrus.WithFields(logrus.Fields{
				"mailing_id":   arl.mailingID,
				"wait_count":   waitCount,
				"current_rate": arl.currentRate,
				"token_bucket": arl.tokenBucket,
				"wait_time_ms": waitTime.Milliseconds(),
				"elapsed_ms":   elapsed * 1000,
				"limiter_addr": fmt.Sprintf("%p", arl),
			}).Debug("Wait() waiting for tokens")
		}

		// КРИТИЧЕСКИ ВАЖНО: Отпускаем мьютекс ПЕРЕД сном!
		arl.mutex.Unlock()

		// Спим БЕЗ блокировки мьютекса - позволяем другим горутинам работать
		time.Sleep(waitTime)

		// Повторяем цикл - снова пытаемся получить токен
	}
}

// OnSuccess вызывается при успешной отправке сообщения
func (arl *AdaptiveRateLimiter) OnSuccess() {
	arl.mutex.Lock()
	defer arl.mutex.Unlock()

	arl.successCount++
	// НЕ инкрементируем totalProcessed здесь, так как он инкрементируется в OnProcessed()

	// Вычисляем фактическую скорость
	elapsed := time.Since(arl.startTime).Seconds()
	actualRate := float64(arl.totalProcessed) / elapsed

	// Увеличиваем скорость каждые N обработанных сообщений
	if arl.successCount >= arl.rateIncreaseThreshold {
		oldRate := arl.currentRate
		arl.currentRate = min(arl.currentRate+arl.rateIncreaseStep, arl.maxRate)

		if arl.currentRate != oldRate {
			logrus.WithFields(logrus.Fields{
				"mailing_id":      arl.mailingID,
				"old_rate":        oldRate,
				"new_rate":        arl.currentRate,
				"processed_count": arl.successCount,
				"total_processed": arl.totalProcessed,
				"actual_rate":     actualRate,
				"flood_count":     arl.floodWaitCount,
				"max_rate":        arl.maxRate,
				"elapsed_sec":     elapsed,
			}).Info("Rate increased due to processed messages")
		}

		arl.successCount = 0 // сбрасываем счетчик
	}

	// Логируем каждые 50 обработанных сообщений для мониторинга прогресса
	if arl.successCount%50 == 0 && arl.successCount > 0 {
		logrus.WithFields(logrus.Fields{
			"mailing_id":      arl.mailingID,
			"processed_count": arl.successCount,
			"total_processed": arl.totalProcessed,
			"current_rate":    arl.currentRate,
			"actual_rate":     actualRate,
			"max_rate":        arl.maxRate,
			"flood_count":     arl.floodWaitCount,
			"elapsed_sec":     elapsed,
			"token_bucket":    arl.tokenBucket,
		}).Info("Rate limiter progress update")
	}
}

// OnProcessed вызывается при обработке любого сообщения (успешного или нет)
func (arl *AdaptiveRateLimiter) OnProcessed() {
	arl.mutex.Lock()
	defer arl.mutex.Unlock()

	arl.successCount++
	// ИНКРЕМЕНТИРУЕМ totalProcessed только здесь - один раз на сообщение!
	arl.totalProcessed++

	// Вычисляем фактическую скорость
	elapsed := time.Since(arl.startTime).Seconds()
	actualRate := float64(arl.totalProcessed) / elapsed

	// Диагностическое логирование каждые 10 обработанных сообщений для отладки
	if arl.totalProcessed%10 == 0 {
		logrus.WithFields(logrus.Fields{
			"mailing_id":      arl.mailingID,
			"current_rate":    arl.currentRate,
			"token_bucket":    arl.tokenBucket,
			"elapsed_seconds": elapsed,
			"total_processed": arl.totalProcessed,
			"actual_rate":     actualRate,
			"success_count":   arl.successCount,
			"limiter_addr":    fmt.Sprintf("%p", arl),
		}).Debug("OnProcessed() increment check")
	}

	// Увеличиваем скорость каждые N обработанных сообщений
	if arl.successCount >= arl.rateIncreaseThreshold {
		oldRate := arl.currentRate
		arl.currentRate = min(arl.currentRate+arl.rateIncreaseStep, arl.maxRate)

		if arl.currentRate != oldRate {
			logrus.WithFields(logrus.Fields{
				"mailing_id":      arl.mailingID,
				"old_rate":        oldRate,
				"new_rate":        arl.currentRate,
				"processed_count": arl.successCount,
				"total_processed": arl.totalProcessed,
				"actual_rate":     actualRate,
				"flood_count":     arl.floodWaitCount,
				"max_rate":        arl.maxRate,
				"elapsed_sec":     elapsed,
				"limiter_addr":    fmt.Sprintf("%p", arl),
			}).Info("Rate increased due to processed messages")
		}

		arl.successCount = 0 // сбрасываем счетчик
	}

	// Логируем каждые 50 обработанных сообщений для мониторинга прогресса
	if arl.successCount%50 == 0 && arl.successCount > 0 {
		logrus.WithFields(logrus.Fields{
			"mailing_id":      arl.mailingID,
			"processed_count": arl.successCount,
			"total_processed": arl.totalProcessed,
			"current_rate":    arl.currentRate,
			"actual_rate":     actualRate,
			"max_rate":        arl.maxRate,
			"flood_count":     arl.floodWaitCount,
			"elapsed_sec":     elapsed,
			"token_bucket":    arl.tokenBucket,
			"limiter_addr":    fmt.Sprintf("%p", arl),
		}).Info("Rate limiter progress update")
	}
}

// OnFloodWait вызывается при получении FLOOD_WAIT ошибки
func (arl *AdaptiveRateLimiter) OnFloodWait(waitSeconds int) {
	arl.mutex.Lock()
	defer arl.mutex.Unlock()

	now := time.Now()

	// ЗАЩИТА: Если FLOOD_WAIT уже был обработан недавно, не снижаем скорость повторно
	if !arl.lastFloodWaitTime.IsZero() && now.Sub(arl.lastFloodWaitTime) < time.Duration(waitSeconds)*time.Second {
		logrus.WithFields(logrus.Fields{
			"mailing_id":         arl.mailingID,
			"flood_wait_seconds": waitSeconds,
			"time_since_last":    now.Sub(arl.lastFloodWaitTime).Seconds(),
		}).Debug("FLOOD_WAIT already processed recently, skipping rate decrease")
		return
	}

	arl.lastFloodWaitTime = now
	arl.floodWaitCount++
	arl.successCount = 0 // сбрасываем счетчик успешных отправок

	oldRate := arl.currentRate
	oldMaxRate := arl.maxRate

	// Снижаем текущую скорость: если 20% меньше 2, то снижаем на 2, иначе на 20%
	decrease := max(2.0, arl.currentRate*0.2)
	arl.currentRate = max(arl.currentRate-decrease, 2.0)

	// Также снижаем максимальную скорость для этого бота
	decreaseMax := max(2.0, arl.maxRate*0.2)
	arl.maxRate = max(arl.maxRate-decreaseMax, 2.0)

	// Уменьшаем шаг увеличения скорости
	if arl.floodWaitCount > 3 {
		arl.rateIncreaseStep = max(arl.rateIncreaseStep*0.8, 0.5)             // минимум 0.5
		arl.rateIncreaseThreshold = minInt(arl.rateIncreaseThreshold+20, 200) // увеличиваем порог
	}

	logrus.WithFields(logrus.Fields{
		"mailing_id":         arl.mailingID,
		"flood_wait_seconds": waitSeconds,
		"flood_count":        arl.floodWaitCount,
		"old_rate":           oldRate,
		"new_rate":           arl.currentRate,
		"old_max_rate":       oldMaxRate,
		"new_max_rate":       arl.maxRate,
		"increase_step":      arl.rateIncreaseStep,
		"increase_threshold": arl.rateIncreaseThreshold,
	}).Warn("Rate decreased due to FLOOD_WAIT")
}

// OnError вызывается при обычной ошибке (не FLOOD_WAIT)
func (arl *AdaptiveRateLimiter) OnError() {
	arl.mutex.Lock()
	defer arl.mutex.Unlock()

	// При обычной ошибке просто сбрасываем счетчик успешных отправок
	// но не меняем скорость
	arl.successCount = maxInt(arl.successCount-10, 0)
}

// GetCurrentRate возвращает текущую скорость
func (arl *AdaptiveRateLimiter) GetCurrentRate() float64 {
	arl.mutex.RLock()
	defer arl.mutex.RUnlock()
	return arl.currentRate
}

// GetMaxRate возвращает максимальную скорость
func (arl *AdaptiveRateLimiter) GetMaxRate() float64 {
	arl.mutex.RLock()
	defer arl.mutex.RUnlock()
	return arl.maxRate
}

// GetActualRate возвращает фактическую скорость обработки
func (arl *AdaptiveRateLimiter) GetActualRate() float64 {
	arl.mutex.RLock()
	defer arl.mutex.RUnlock()

	elapsed := time.Since(arl.startTime).Seconds()
	if elapsed <= 0 {
		return 0
	}
	return float64(arl.totalProcessed) / elapsed
}

// GetStats возвращает статистику rate limiter
func (arl *AdaptiveRateLimiter) GetStats() map[string]interface{} {
	arl.mutex.RLock()
	defer arl.mutex.RUnlock()

	// Вычисляем фактическую скорость
	elapsed := time.Since(arl.startTime).Seconds()
	actualRate := float64(arl.totalProcessed) / elapsed

	return map[string]interface{}{
		"current_rate":       arl.currentRate,
		"max_rate":           arl.maxRate,
		"min_rate":           arl.minRate,
		"flood_wait_count":   arl.floodWaitCount,
		"processed_count":    arl.successCount, // переименовали для ясности
		"total_processed":    arl.totalProcessed,
		"actual_rate":        actualRate,
		"rate_increase_step": arl.rateIncreaseStep,
		"increase_threshold": arl.rateIncreaseThreshold,
		"elapsed_seconds":    elapsed,
		"token_bucket":       arl.tokenBucket,
	}
}

// Reset сбрасывает rate limiter к начальным значениям
func (arl *AdaptiveRateLimiter) Reset() {
	arl.mutex.Lock()
	defer arl.mutex.Unlock()

	arl.currentRate = arl.initialRate
	arl.maxRate = 60.0
	arl.floodWaitCount = 0
	arl.successCount = 0
	arl.rateIncreaseStep = 1.0
	arl.rateIncreaseThreshold = 100

	logrus.WithFields(logrus.Fields{
		"mailing_id": arl.mailingID,
		"rate":       arl.currentRate,
	}).Info("Rate limiter reset to initial values")
}

// LocalRateLimiter представляет локальный лимитер для потока
// Он синхронизируется с глобальным лимитером
func (arl *AdaptiveRateLimiter) NewLocalRateLimiter() *AdaptiveRateLimiter {
	return &AdaptiveRateLimiter{
		currentRate:           arl.currentRate,
		maxRate:               arl.maxRate,
		minRate:               arl.minRate,
		rateIncreaseStep:      arl.rateIncreaseStep,
		rateDecreaseStep:      arl.rateDecreaseStep,
		rateIncreaseThreshold: arl.rateIncreaseThreshold,
		mailingID:             arl.mailingID,
		startTime:             time.Now(),
	}
}

// SyncWithGlobal синхронизирует локальный лимитер с глобальным
func (arl *AdaptiveRateLimiter) SyncWithGlobal(globalLimiter *AdaptiveRateLimiter) {
	arl.mutex.Lock()
	defer arl.mutex.Unlock()

	globalLimiter.mutex.RLock()
	defer globalLimiter.mutex.RUnlock()

	arl.currentRate = globalLimiter.currentRate
	arl.maxRate = globalLimiter.maxRate
}

// min возвращает минимальное из двух значений
func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// max возвращает максимальное из двух значений
func max(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

// minInt возвращает минимальное из двух int значений
func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// maxInt возвращает максимальное из двух int значений
func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// GetLastFloodWaitTime возвращает время последнего FLOOD_WAIT
func (arl *AdaptiveRateLimiter) GetLastFloodWaitTime() time.Time {
	arl.mutex.RLock()
	defer arl.mutex.RUnlock()
	return arl.lastFloodWaitTime
}
