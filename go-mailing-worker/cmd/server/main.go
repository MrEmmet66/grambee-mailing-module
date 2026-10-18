package main

import (
	"context"
	"flag"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"go-mailing-worker/internal/handlers"
	"go-mailing-worker/internal/manager"
	"go-mailing-worker/internal/metrics"
	"go-mailing-worker/internal/ratelimiter"
	"go-mailing-worker/internal/tasks"
	"go-mailing-worker/internal/telegram"
	"go-mailing-worker/internal/utils"
	"go-mailing-worker/internal/worker"

	"github.com/gin-gonic/gin"
	"github.com/hibiken/asynq"
	"github.com/hibiken/asynqmon"
	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"
)

func main() {
	// Парсинг аргументов командной строки
	mode := flag.String("mode", "manager", "Mode: manager or worker")
	queueName := flag.String("queue", "", "Queue name for worker mode")
	mailingID := flag.String("mailing-id", "", "Mailing ID for worker mode")
	redisAddrFlag := flag.String("redis-addr", "", "Redis address")
	redisPasswordFlag := flag.String("redis-password", "", "Redis password")
	redisDBFlag := flag.String("redis-db", "0", "Redis database")
	concurrencyFlag := flag.String("concurrency", "50", "Worker concurrency")
	totalTasksFlag := flag.String("total-tasks", "0", "Total number of tasks for this mailing") // ИСПРАВЛЯЕМ: Добавляем параметр
	flag.Parse()

	// Настройка логирования
	logrus.SetFormatter(&logrus.JSONFormatter{})
	logrus.SetLevel(logrus.InfoLevel) // ТЕСТ: Включаем INFO логи для видимости времени обработки

	// Загрузка конфигурации
	redisAddr := utils.GetEnv("REDIS_ADDR", "localhost:6379")
	redisPassword := utils.GetEnv("REDIS_PASSWORD", "")
	redisDB := 0

	// Переопределяем из флагов если указаны
	if *redisAddrFlag != "" {
		redisAddr = *redisAddrFlag
	}
	if *redisPasswordFlag != "" {
		redisPassword = *redisPasswordFlag
	}
	if *redisDBFlag != "0" {
		if db, err := strconv.Atoi(*redisDBFlag); err == nil {
			redisDB = db
		}
	}

	concurrency := 50
	if *concurrencyFlag != "50" {
		if c, err := strconv.Atoi(*concurrencyFlag); err == nil {
			concurrency = c
		}
	}

	// ИСПРАВЛЯЕМ: Парсим общее количество задач из аргументов
	totalTasksFromArgs := 0
	if *totalTasksFlag != "0" {
		if c, err := strconv.Atoi(*totalTasksFlag); err == nil {
			totalTasksFromArgs = c
		}
	}

	logrus.WithFields(logrus.Fields{
		"mode":        *mode,
		"queue":       *queueName,
		"mailing_id":  *mailingID,
		"redis_addr":  redisAddr,
		"concurrency": concurrency,
	}).Info("Starting application with REAL Telegram API")

	switch *mode {
	case "worker":
		if *queueName == "" || *mailingID == "" {
			logrus.Fatal("Worker mode requires -queue and -mailing-id parameters")
		}
		runWorker(redisAddr, redisPassword, redisDB, *queueName, *mailingID, concurrency, totalTasksFromArgs)
	case "manager":
		runManager(redisAddr, redisPassword, redisDB)
	default:
		logrus.Fatalf("Unknown mode: %s. Use 'manager' or 'worker'", *mode)
	}
}

// runManager запускает менеджер с API и мониторингом
func runManager(redisAddr, redisPassword string, redisDB int) {
	port := utils.GetEnv("PORT", "8080")

	// Создание Redis клиента для asynq
	redisOpt := asynq.RedisClientOpt{
		Addr:     redisAddr,
		Password: redisPassword,
		DB:       redisDB,
	}

	// Создание asynq клиента
	client := asynq.NewClient(redisOpt)
	defer client.Close()

	// Создание Redis клиента для метрик
	redisClient := redis.NewClient(&redis.Options{
		Addr:     redisAddr,
		Password: redisPassword,
		DB:       redisDB,
	})
	defer redisClient.Close()

	// Создание трекера метрик
	metricsTracker := metrics.NewMetricsTracker(redisClient)

	// Создание менеджера воркеров
	executablePath, err := os.Executable()
	if err != nil {
		logrus.WithError(err).Fatal("Failed to get executable path")
	}

	workerManager := manager.NewWorkerManager(redisAddr, redisPassword, redisDB, executablePath)

	// Создание обработчиков
	mailingHandler := handlers.NewMailingHandler(client, metricsTracker, workerManager)
	workerHandler := handlers.NewWorkerHandler(workerManager)
	metricsHandler := handlers.NewMetricsHandler(metricsTracker)

	// Настройка Gin
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery())

	// API маршруты
	api := router.Group("/api/v1")
	{
		api.POST("/mailing", mailingHandler.CreateMailing)
		api.GET("/mailing/:id", mailingHandler.GetMailingStatus)
		api.GET("/mailing/:id/metrics", mailingHandler.GetMailingMetrics)
		api.GET("/mailings/:id/metrics", metricsHandler.GetMailingMetrics)
		api.GET("/metrics", mailingHandler.GetAllMailingMetrics)
		api.GET("/metrics/all", metricsHandler.GetAllMailingMetrics)
		api.POST("/workers/:id/stop", workerHandler.StopWorker)
		api.GET("/workers", workerHandler.GetAllWorkers)
		api.GET("/health", mailingHandler.HealthCheck)
	}

	// Настройка asynqmon для мониторинга
	h := asynqmon.New(asynqmon.Options{
		RootPath:     "/monitoring",
		RedisConnOpt: redisOpt,
	})
	router.Any("/monitoring/*any", gin.WrapH(h))
	router.GET("/monitoring", gin.WrapH(h))

	// Запуск веб-сервера в отдельной горутине
	go func() {
		logrus.WithField("port", port).Info("Starting manager server")
		if err := router.Run(":" + port); err != nil {
			logrus.WithError(err).Fatal("Failed to start server")
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logrus.Info("Shutting down manager...")

	// Останавливаем все воркеры
	workerManager.StopAllWorkers()

	logrus.Info("Manager shutdown complete")
}

// runWorker запускает отдельный воркер для рассылки
func runWorker(redisAddr, redisPassword string, redisDB int, queueName, mailingID string, concurrency int, totalTasksFromArgs int) {
	// Создание Redis клиента для метрик с увеличенным connection pool
	redisClient := redis.NewClient(&redis.Options{
		Addr:         redisAddr,
		Password:     redisPassword,
		DB:           redisDB,
		PoolSize:     concurrency * 2, // Больше connections для высокой concurrency
		DialTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
	})
	defer redisClient.Close()

	// Создание трекера метрик
	metricsTracker := metrics.NewMetricsTracker(redisClient)

	// Создание инспектора для получения информации об очереди
	inspector := asynq.NewInspector(asynq.RedisClientOpt{
		Addr:     redisAddr,
		Password: redisPassword,
		DB:       redisDB,
	})
	defer inspector.Close()

	// ИСПРАВЛЯЕМ: Используем переданное количество задач вместо вычисления из очереди
	var totalTasks int
	if totalTasksFromArgs > 0 {
		totalTasks = totalTasksFromArgs
		logrus.WithFields(logrus.Fields{
			"mailing_id":  mailingID,
			"total_tasks": totalTasks,
		}).Info("Using total tasks from command line arguments")
	} else {
		// Fallback: если не передано, вычисляем из очереди (но это менее точно)
		queueInfo, err := inspector.GetQueueInfo(queueName)
		if err != nil {
			logrus.WithError(err).Fatal("Failed to get queue info for metrics initialization")
		}
		totalTasks = queueInfo.Pending + queueInfo.Active + queueInfo.Scheduled + queueInfo.Processed
		logrus.WithFields(logrus.Fields{
			"mailing_id":  mailingID,
			"total_tasks": totalTasks,
			"pending":     queueInfo.Pending,
			"active":      queueInfo.Active,
			"scheduled":   queueInfo.Scheduled,
			"processed":   queueInfo.Processed,
		}).Warn("Using total tasks calculated from queue (less accurate)")
	}

	if err := metricsTracker.InitMailingMetrics(context.Background(), mailingID, totalTasks); err != nil {
		logrus.WithError(err).Warn("Failed to initialize metrics, continuing without initialization")
	}

	// Создание Telegram клиента
	telegramToken := utils.GetEnv("TELEGRAM_BOT_TOKEN", "")
	telegramClient := telegram.NewClient(telegramToken)

	// ВОССТАНАВЛИВАЕМ: Адаптивный rate limiter для корректного лимитирования
	rateLimiter := ratelimiter.NewAdaptiveRateLimiter(mailingID)

	logrus.WithFields(logrus.Fields{
		"mailing_id":   mailingID,
		"concurrency":  concurrency,
		"type":         "AdaptiveRateLimiter",
		"initial_rate": 25.0,
		"max_rate":     60.0,
	}).Info("RESTORED adaptive rate limiter - PROPER SPEED CONTROL!")

	// Создание воркера с изолированной очередью
	srv := worker.NewWorker(worker.Config{
		RedisAddr:     redisAddr,
		RedisPassword: redisPassword,
		RedisDB:       redisDB,
		Concurrency:   concurrency,
		Queues: map[string]int{
			queueName: concurrency, // Только одна очередь для этой рассылки
		},
	})

	// Регистрация обработчиков задач
	mux := asynq.NewServeMux()
	sendMessageHandler := tasks.NewSendMessageHandler(telegramClient, rateLimiter, metricsTracker)
	mux.HandleFunc(tasks.TypeSendMessage, sendMessageHandler.HandleSendMessage)

	// Горутина для мониторинга завершения работы
	go func() {
		ticker := time.NewTicker(5 * time.Second) // Проверяем каждые 5 секунд
		defer ticker.Stop()

		consecutiveIdleChecks := 0
		maxConsecutiveIdleChecks := 3 // УВЕЛИЧИВАЕМ: 3 проверки * 5 секунд = 15 секунд стабильности
		startTime := time.Now()
		maxWorkTime := 16 * time.Hour // Максимальное время работы worker - 16 часов
		lastLogTime := time.Now()

		for range ticker.C {
			// Принудительный timeout
			if time.Since(startTime) > maxWorkTime {
				// При принудительном timeout также отправляем callback с текущей статистикой
				queueInfo, err := inspector.GetQueueInfo(queueName)
				if err == nil {
					backendURL := utils.GetEnv("MAIN_SERVICE_URL", "http://nest-app:3000/api/v1")
					if err := utils.SendMailingCompletion(backendURL, queueName, queueInfo.Processed, queueInfo.Failed); err != nil {
						logrus.WithError(err).WithFields(logrus.Fields{
							"backend_url": backendURL,
							"queue_name":  queueName,
							"processed":   queueInfo.Processed,
							"failed":      queueInfo.Failed,
						}).Error("Failed to send mailing completion callback on timeout")
					}
				}

				logrus.WithFields(logrus.Fields{
					"mailing_id": mailingID,
					"work_time":  time.Since(startTime).String(),
				}).Warn("Worker max time exceeded, force shutting down")
				srv.Shutdown()
				return
			}

			queueInfo, err := inspector.GetQueueInfo(queueName)
			if err != nil {
				logrus.WithError(err).Debug("Failed to get queue info")
				continue
			}

			// Логируем rate limiter статистику каждые 30 секунд или при изменениях
			shouldLogRateStats := time.Since(lastLogTime) > 30*time.Second
			if shouldLogRateStats {
				rateStats := rateLimiter.GetStats()
				logrus.WithFields(logrus.Fields{
					"mailing_id":   mailingID,
					"active":       queueInfo.Active,
					"pending":      queueInfo.Pending,
					"processed":    queueInfo.Processed,
					"failed":       queueInfo.Failed,
					"current_rate": rateLimiter.GetCurrentRate(),
					"actual_rate":  rateLimiter.GetActualRate(),
					"max_rate":     rateLimiter.GetMaxRate(),
					"rate_stats":   rateStats,
				}).Info("Worker progress with rate limiter stats")
				lastLogTime = time.Now()
			}

			// ИСПРАВЛЯЕМ: Игнорируем failed задачи при проверке завершения - они уже обработаны
			logrus.WithFields(logrus.Fields{
				"mailing_id":       mailingID,
				"active":           queueInfo.Active,
				"pending":          queueInfo.Pending,
				"scheduled":        queueInfo.Scheduled,
				"retry":            queueInfo.Retry,
				"processed":        queueInfo.Processed,
				"failed":           queueInfo.Failed,
				"consecutive_idle": consecutiveIdleChecks,
				"current_rate":     rateLimiter.GetCurrentRate(),
				"actual_rate":      rateLimiter.GetActualRate(),
				"max_rate":         rateLimiter.GetMaxRate(),
			}).Debug("Queue status check - failed tasks are ignored for completion")

			// ИСПРАВЛЯЕМ: Проверяем завершение ТОЛЬКО по обработанным задачам
			// Игнорируем pending, так как failed задачи остаются там навсегда
			// Проверяем только: нет активных/scheduled/retry + обработано >= общего количества
			noActiveOrScheduledTasks := queueInfo.Active == 0 && queueInfo.Scheduled == 0 && queueInfo.Retry == 0
			allTasksProcessed := totalTasks > 0 && queueInfo.Processed >= totalTasks

			// Завершаем только по processed
			if noActiveOrScheduledTasks && allTasksProcessed {
				consecutiveIdleChecks++

				logrus.WithFields(logrus.Fields{
					"mailing_id":          mailingID,
					"no_active_scheduled": noActiveOrScheduledTasks,
					"all_tasks_processed": allTasksProcessed,
					// ...убрано: exact_task_match, task_overflow
					"processed":             queueInfo.Processed,
					"failed":                queueInfo.Failed,
					"pending":               queueInfo.Pending,
					"total_tasks":           totalTasks,
					"processed_plus_failed": queueInfo.Processed + queueInfo.Failed,
					"consecutive_checks":    consecutiveIdleChecks,
					"max_checks":            maxConsecutiveIdleChecks,
				}).Info("Checking completion criteria")

				if consecutiveIdleChecks >= maxConsecutiveIdleChecks {
					// Логируем финальную статистику rate limiter
					rateStats := rateLimiter.GetStats()
					logrus.WithFields(logrus.Fields{
						"mailing_id":  mailingID,
						"processed":   queueInfo.Processed,
						"failed":      queueInfo.Failed,
						"total_tasks": totalTasks,
						"completion_reason": func() string {
							if allTasksProcessed {
								return "all_tasks_processed"
							}
							return "no_active_scheduled"
						}(),
						"total_idle_time": consecutiveIdleChecks * 5,
						"rate_limiter":    rateStats,
					}).Info("All tasks completed, shutting down worker")

					// Отправляем callback на бекенд о завершении рассылки
					backendURL := utils.GetEnv("MAIN_SERVICE_URL", "http://nest-app:3000/api/v1")
					if err := utils.SendMailingCompletion(backendURL, queueName, queueInfo.Processed, queueInfo.Failed); err != nil {
						logrus.WithError(err).WithFields(logrus.Fields{
							"backend_url": backendURL,
							"queue_name":  queueName,
							"processed":   queueInfo.Processed,
							"failed":      queueInfo.Failed,
						}).Error("Failed to send mailing completion callback to backend")
					}

					// КРИТИЧЕСКИ ВАЖНО: Удаляем очередь НЕМЕДЛЕННО, чтобы предотвратить повторное создание задач
					logrus.WithField("queue_name", queueName).Info("Deleting queue immediately to prevent duplicates")
					err := inspector.DeleteQueue(queueName, true) // force = true для немедленного удаления
					if err != nil {
						logrus.WithError(err).WithField("queue_name", queueName).Warn("Failed to delete queue immediately")
					} else {
						logrus.WithField("queue_name", queueName).Info("Queue deleted successfully")
					}

					srv.Shutdown()
					return
				}
			} else {
				consecutiveIdleChecks = 0 // Сбрасываем счетчик если есть активность
			}
		}
	}()

	// Горутина для обработки сигналов завершения
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-quit
		logrus.WithField("mailing_id", mailingID).Info("Shutting down worker...")

		// При принудительном завершении также отправляем callback с текущей статистикой
		queueInfo, err := inspector.GetQueueInfo(queueName)
		if err == nil {
			backendURL := utils.GetEnv("MAIN_SERVICE_URL", "http://nest-app:3000/api/v1")
			if err := utils.SendMailingCompletion(backendURL, queueName, queueInfo.Processed, queueInfo.Failed); err != nil {
				logrus.WithError(err).WithFields(logrus.Fields{
					"backend_url": backendURL,
					"queue_name":  queueName,
					"processed":   queueInfo.Processed,
					"failed":      queueInfo.Failed,
				}).Error("Failed to send mailing completion callback on forced shutdown")
			}
		}

		srv.Shutdown()
	}()

	// Запуск воркера
	logrus.WithFields(logrus.Fields{
		"mailing_id":  mailingID,
		"queue_name":  queueName,
		"concurrency": concurrency,
	}).Info("Starting dedicated worker")

	if err := srv.Run(mux); err != nil {
		logrus.WithError(err).WithField("mailing_id", mailingID).Error("Worker failed")
		os.Exit(1)
	}

	logrus.WithField("mailing_id", mailingID).Info("Worker shutdown complete")
}
