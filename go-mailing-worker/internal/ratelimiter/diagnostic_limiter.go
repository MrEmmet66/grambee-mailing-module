package ratelimiter

import (
	"sync/atomic"
	"time"
)

// DiagnosticRateLimiter для диагностики - БЕЗ БЛОКИРОВОК!
type DiagnosticRateLimiter struct {
	mailingID      string
	totalProcessed int64 // Используем atomic операции
	startTime      time.Time
	concurrency    int
	lastLogTime    int64 // Timestamp для atomic операций
}

// NewDiagnosticRateLimiter создает диагностический rate limiter
func NewDiagnosticRateLimiter(mailingID string, concurrency int) *DiagnosticRateLimiter {
	now := time.Now()

	return &DiagnosticRateLimiter{
		mailingID:      mailingID,
		totalProcessed: 0,
		startTime:      now,
		concurrency:    concurrency,
		lastLogTime:    now.Unix(),
	}
}

// Wait ничего не делает - полная скорость
func (drl *DiagnosticRateLimiter) Wait() {
	// Никаких ограничений!
}

// OnProcessed минимальная обработка БЕЗ БЛОКИРОВОК
func (drl *DiagnosticRateLimiter) OnProcessed() {
	// Atomic increment - самая быстрая операция
	processed := atomic.AddInt64(&drl.totalProcessed, 1)
	
	// Логируем только каждые 5 секунд БЕЗ блокировок
	now := time.Now()
	currentLogTime := atomic.LoadInt64(&drl.lastLogTime)
	if now.Unix()-currentLogTime >= 5 {
		// Попытка обновить lastLogTime атомарно
		if atomic.CompareAndSwapInt64(&drl.lastLogTime, currentLogTime, now.Unix()) {
			elapsed := now.Sub(drl.startTime).Seconds()
			actualRate := float64(processed) / elapsed
			
			// Печатаем в stdout напрямую без logrus
			println("DIAGNOSTIC:", drl.mailingID, "processed:", processed, "rate:", actualRate, "elapsed:", elapsed)
		}
	}
}

// OnFloodWait ничего не делает
func (drl *DiagnosticRateLimiter) OnFloodWait(retryAfter int) {
	// Ничего не делаем
}

// GetCurrentRate возвращает текущую скорость
func (drl *DiagnosticRateLimiter) GetCurrentRate() float64 {
	processed := atomic.LoadInt64(&drl.totalProcessed)
	elapsed := time.Since(drl.startTime).Seconds()
	if elapsed > 0 {
		return float64(processed) / elapsed
	}
	return 0
}

// GetMaxRate возвращает максимальную скорость (unlimited)
func (drl *DiagnosticRateLimiter) GetMaxRate() float64 {
	return 999 // Unlimited
}

// GetStats возвращает статистику
func (drl *DiagnosticRateLimiter) GetStats() map[string]interface{} {
	processed := atomic.LoadInt64(&drl.totalProcessed)
	elapsed := time.Since(drl.startTime).Seconds()
	actualRate := float64(0)
	if elapsed > 0 {
		actualRate = float64(processed) / elapsed
	}

	return map[string]interface{}{
		"Type":           "DiagnosticRateLimiter",
		"CurrentRate":    999,
		"MaxRate":        999,
		"ActualRate":     actualRate,
		"TotalProcessed": processed,
		"ElapsedSeconds": elapsed,
	}
}

// GetActualRate для совместимости с интерфейсом
func (drl *DiagnosticRateLimiter) GetActualRate() float64 {
	return drl.GetCurrentRate()
}
