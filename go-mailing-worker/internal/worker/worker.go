package worker

import (
	"context"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"github.com/sirupsen/logrus"
)

// Config конфигурация воркера
type Config struct {
	RedisAddr     string
	RedisPassword string
	RedisDB       int
	Concurrency   int
	Queues        map[string]int
}

// NewWorker создает новый воркер
func NewWorker(config Config) *asynq.Server {
	redisOpt := asynq.RedisClientOpt{
		Addr:     config.RedisAddr,
		Password: config.RedisPassword,
		DB:       config.RedisDB,
		// КРИТИЧЕСКИ ВАЖНО: Максимальные настройки для скорости извлечения задач
		PoolSize:     config.Concurrency * 4, // Еще больше connections
		DialTimeout:  1 * time.Second,        // Быстрее подключение
		ReadTimeout:  1 * time.Second,        // Быстрее чтение
		WriteTimeout: 1 * time.Second,        // Быстрее запись
	}

	return asynq.NewServer(
		redisOpt,
		asynq.Config{
			Concurrency: config.Concurrency,
			Queues:      config.Queues,
			// КРИТИЧЕСКИ ВАЖНО: Настройки для максимальной скорости извлечения задач
			ShutdownTimeout:          5 * time.Second,        // Быстрый shutdown
			HealthCheckInterval:      30 * time.Second,       // Реже проверки здоровья
			DelayedTaskCheckInterval: 100 * time.Millisecond, // КЛЮЧЕВОЕ: Очень часто проверяем задачи!
			GroupGracePeriod:         0,                      // Без группировки
			GroupMaxDelay:            0,                      // Без задержек группировки
			GroupMaxSize:             1,                      // По одной задаче
			BaseContext: func() context.Context {
				return context.Background()
			},
			// КРИТИЧЕСКИ ВАЖНО: Отключаем ретраи для всех ошибок кроме FLOOD_WAIT
			RetryDelayFunc: func(n int, e error, t *asynq.Task) time.Duration {
				// ТОЛЬКО FLOOD_WAIT может быть ретраем, но МАКСИМУМ 3 попытки
				if isFloodWaitError(e) && n < 3 {
					logrus.WithFields(logrus.Fields{
						"task_type":     t.Type(),
						"retry_attempt": n,
						"error":         e.Error(),
						"max_retries":   3,
					}).Warn("FLOOD_WAIT retry scheduled")
					return 0 // Без задержки, так как sleep уже был в задаче
				}
				// Не логгируем DELIVERY_FAILED
				if isDeliveryFailedError(e) {
					return -1
				}
				// ВСЕ ОСТАЛЬНЫЕ ОШИБКИ = НЕ РЕТРАЙ, ИДЕМ ДАЛЬШЕ!
				logrus.WithFields(logrus.Fields{
					"task_type": t.Type(),
					"error":     e.Error(),
				}).Error("Task failed permanently - NO RETRY")
				return -1 // -1 означает НЕ ретраить
			},
			ErrorHandler: asynq.ErrorHandlerFunc(func(ctx context.Context, task *asynq.Task, err error) {
				// Не логгируем DELIVERY_FAILED
				if isDeliveryFailedError(err) {
					return
				}
				// Логируем все ошибки для диагностики
				logrus.WithFields(logrus.Fields{
					"task_type":     task.Type(),
					"error":         err.Error(),
					"is_flood_wait": isFloodWaitError(err),
				}).Error("Task processing completed with error")
			}),
			Logger: NewLogrusLogger(),
			// Включаем строгий режим приоритетов
			StrictPriority: true,
			// Оптимизация для высокой нагрузки
			HealthCheckFunc: func(err error) {
				if err != nil {
					logrus.WithError(err).Error("Worker health check failed")
				}
			},
			// КРИТИЧЕСКИ ВАЖНО: Определяем что считается неудачей
			IsFailure: func(err error) bool {
				// Все ошибки считаются неудачей для статистики
				// FLOOD_WAIT будет ретраиться до 3 раз, потом тоже станет failed
				return true
			},
		},
	)
}

// isFloodWaitError проверяет, является ли ошибка FLOOD_WAIT
func isFloodWaitError(err error) bool {
	if err == nil {
		return false
	}
	errMsg := err.Error()
	return strings.Contains(errMsg, "FLOOD_WAIT") ||
		strings.Contains(errMsg, "Too Many Requests") ||
		strings.Contains(errMsg, "retry after")
}

// isDeliveryFailedError проверяет, является ли ошибка неудачной доставкой
func isDeliveryFailedError(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "DELIVERY_FAILED")
}

// LogrusLogger адаптер для использования logrus с asynq
type LogrusLogger struct{}

func NewLogrusLogger() *LogrusLogger {
	return &LogrusLogger{}
}

func (l *LogrusLogger) Debug(args ...interface{}) {
	logrus.Debug(args...)
}

func (l *LogrusLogger) Info(args ...interface{}) {
	logrus.Info(args...)
}

func (l *LogrusLogger) Warn(args ...interface{}) {
	logrus.Warn(args...)
}

func (l *LogrusLogger) Error(args ...interface{}) {
	logrus.Error(args...)
}

func (l *LogrusLogger) Fatal(args ...interface{}) {
	logrus.Fatal(args...)
}
