package main

import (
	"flag"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"go-mailing-worker/internal/handlers"
	"go-mailing-worker/internal/manager"
	"go-mailing-worker/internal/metrics"
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
	flag.Parse()

	// Настройка логирования
	logrus.SetFormatter(&logrus.JSONFormatter{})
	logrus.SetLevel(logrus.InfoLevel)

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

	logrus.WithFields(logrus.Fields{
		"mode":        *mode,
		"queue":       *queueName,
		"mailing_id":  *mailingID,
		"redis_addr":  redisAddr,
		"concurrency": concurrency,
	}).Info("Starting application")

	switch *mode {
	case "worker":
		if *queueName == "" || *mailingID == "" {
			logrus.Fatal("Worker mode requires -queue and -mailing-id parameters")
		}
		runWorker(redisAddr, redisPassword, redisDB, *queueName, *mailingID, concurrency)
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
		api.GET("/metrics", mailingHandler.GetAllMailingMetrics)
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
func runWorker(redisAddr, redisPassword string, redisDB int, queueName, mailingID string, concurrency int) {
	// Создание Redis клиента для метрик
	redisClient := redis.NewClient(&redis.Options{
		Addr:     redisAddr,
		Password: redisPassword,
		DB:       redisDB,
	})
	defer redisClient.Close()

	// Создание трекера метрик
	metricsTracker := metrics.NewMetricsTracker(redisClient)

	// Создание Telegram клиента
	telegramToken := utils.GetEnv("TELEGRAM_BOT_TOKEN", "")
	telegramClient := telegram.NewClient(telegramToken)

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

	// Создание инспектора для мониторинга очереди
	inspector := asynq.NewInspector(asynq.RedisClientOpt{
		Addr:     redisAddr,
		Password: redisPassword,
		DB:       redisDB,
	})
	defer inspector.Close()

	// Регистрация обработчиков задач
	mux := asynq.NewServeMux()
	sendMessageHandler := tasks.NewSendMessageHandler(telegramClient, metricsTracker)
	mux.HandleFunc(tasks.TypeSendMessage, sendMessageHandler.HandleSendMessage)

	// Горутина для мониторинга завершения работы
	go func() {
		ticker := time.NewTicker(5 * time.Second) // Проверяем каждые 5 секунд
		defer ticker.Stop()

		consecutiveIdleChecks := 0
		maxConsecutiveIdleChecks := 6 // 6 проверок * 5 секунд = 30 секунд без активности
		startTime := time.Now()
		maxWorkTime := 30 * time.Minute // Максимальное время работы worker - 30 минут

		for range ticker.C {
			// Принудительный timeout
			if time.Since(startTime) > maxWorkTime {
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

			logrus.WithFields(logrus.Fields{
				"mailing_id":       mailingID,
				"active":           queueInfo.Active,
				"pending":          queueInfo.Pending,
				"scheduled":        queueInfo.Scheduled,
				"retry":            queueInfo.Retry,
				"processed":        queueInfo.Processed,
				"failed":           queueInfo.Failed,
				"consecutive_idle": consecutiveIdleChecks,
			}).Debug("Queue status check")

			// Если нет активных, отложенных или ретраящихся задач
			if queueInfo.Active == 0 && queueInfo.Pending == 0 && queueInfo.Scheduled == 0 && queueInfo.Retry == 0 {
				consecutiveIdleChecks++

				if consecutiveIdleChecks >= maxConsecutiveIdleChecks {
					logrus.WithFields(logrus.Fields{
						"mailing_id":      mailingID,
						"processed":       queueInfo.Processed,
						"failed":          queueInfo.Failed,
						"total_idle_time": consecutiveIdleChecks * 5,
					}).Info("All tasks completed, shutting down worker")

					// Очищаем очередь перед завершением
					go func() {
						time.Sleep(2 * time.Second) // Даем время на graceful shutdown

						// Удаляем очередь из asynq
						err := inspector.DeleteQueue(queueName, false)
						if err != nil {
							logrus.WithError(err).WithField("queue_name", queueName).Warn("Failed to delete queue")
						} else {
							logrus.WithField("queue_name", queueName).Info("Queue deleted successfully")
						}
					}()

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
