package ratelimiter

import (
	"sync"
)

// GlobalRateLimiterManager управляет rate limiter'ами по bot token
// Один rate limiter на каждый bot token, независимо от количества потоков/рассылок
type GlobalRateLimiterManager struct {
	limiters map[string]*AdaptiveRateLimiter // ключ - bot token
	mutex    sync.RWMutex
}

var (
	globalManager *GlobalRateLimiterManager
	once          sync.Once
)

// GetGlobalManager возвращает singleton instance глобального менеджера
func GetGlobalManager() *GlobalRateLimiterManager {
	once.Do(func() {
		globalManager = &GlobalRateLimiterManager{
			limiters: make(map[string]*AdaptiveRateLimiter),
		}
	})
	return globalManager
}

// GetRateLimiter возвращает rate limiter для указанного bot token
// Если не существует - создает новый
func (g *GlobalRateLimiterManager) GetRateLimiter(botToken string, mailingID string) *AdaptiveRateLimiter {
	g.mutex.Lock()
	defer g.mutex.Unlock()

	// Проверяем, есть ли уже rate limiter для этого bot token
	if limiter, exists := g.limiters[botToken]; exists {
		return limiter
	}

	// Создаем новый rate limiter для этого bot token
	limiter := NewAdaptiveRateLimiter(mailingID + "_shared")
	g.limiters[botToken] = limiter

	return limiter
}

// RemoveRateLimiter удаляет rate limiter для указанного bot token
func (g *GlobalRateLimiterManager) RemoveRateLimiter(botToken string) {
	g.mutex.Lock()
	defer g.mutex.Unlock()

	delete(g.limiters, botToken)
}

// GetAllLimiters возвращает все активные rate limiter'ы
func (g *GlobalRateLimiterManager) GetAllLimiters() map[string]*AdaptiveRateLimiter {
	g.mutex.RLock()
	defer g.mutex.RUnlock()

	result := make(map[string]*AdaptiveRateLimiter)
	for k, v := range g.limiters {
		result[k] = v
	}
	return result
}
