package ratelimiter

// RateLimiter общий интерфейс для всех типов rate limiter
type RateLimiter interface {
	Wait()
	OnProcessed()
	OnFloodWait(waitSeconds int)
	GetCurrentRate() float64
	GetMaxRate() float64
	GetActualRate() float64
	GetStats() map[string]interface{}
}
