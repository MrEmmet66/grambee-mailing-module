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
	}

	return asynq.NewServer(
		redisOpt,
		asynq.Config{
			Concurrency: config.Concurrency,
			Queues:      config.Queues,
			// КРИТИЧЕСКИ ВАЖНО: Отключаем ретраи для всех ошибок кроме FLOOD_WAIT
			RetryDelayFunc: func(n int, e error, t *asynq.Task) time.Duration {
				// ТОЛЬКО FLOOD_WAIT может быть ретраем
				if isFloodWaitError(e) {
					// Для FLOOD_WAIT возвращаем 0 - он обрабатывается внутри задачи через sleep
					logrus.WithFields(logrus.Fields{
						"task_type":     t.Type(),
						"retry_attempt": n,
						"error":         e.Error(),
					}).Warn("FLOOD_WAIT retry scheduled")
					return 0 // Без задержки, так как sleep уже был в задаче
				}

				// ВСЕ ОСТАЛЬНЫЕ ОШИБКИ = НЕ РЕТРАЙ, ИДЕМ ДАЛЬШЕ!
				logrus.WithFields(logrus.Fields{
					"task_type": t.Type(),
					"error":     e.Error(),
				}).Error("Task failed permanently - NO RETRY")
				return -1 // -1 означает НЕ ретраить
			},
			ErrorHandler: asynq.ErrorHandlerFunc(func(ctx context.Context, task *asynq.Task, err error) {
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
				// FLOOD_WAIT НЕ считается неудачей - он будет ретраиться
				if isFloodWaitError(err) {
					return false
				}
				// ВСЕ ОСТАЛЬНЫЕ ОШИБКИ = НЕУДАЧА, БЕЗ РЕТРАЯ
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
