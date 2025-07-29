package manager

import (
	"fmt"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/sirupsen/logrus"
)

// WorkerProcess представляет процесс воркера
type WorkerProcess struct {
	MailingID      string
	QueueName      string
	ProcessID      int
	Cmd            *exec.Cmd
	StartedAt      time.Time
	Status         string // running, stopping, stopped, failed
	TotalTasks     int
	CompletedTasks int
	FailedTasks    int
}

// WorkerManager управляет процессами воркеров
type WorkerManager struct {
	workers       map[string]*WorkerProcess
	mutex         sync.RWMutex
	redisAddr     string
	redisPassword string
	redisDB       int
	basePath      string // Путь к исполняемому файлу воркера
}

// NewWorkerManager создает новый менеджер воркеров
func NewWorkerManager(redisAddr, redisPassword string, redisDB int, basePath string) *WorkerManager {
	return &WorkerManager{
		workers:       make(map[string]*WorkerProcess),
		redisAddr:     redisAddr,
		redisPassword: redisPassword,
		redisDB:       redisDB,
		basePath:      basePath,
	}
}

// StartWorker запускает новый воркер для рассылки
func (wm *WorkerManager) StartWorker(mailingID string, totalTasks int) (*WorkerProcess, error) {
	wm.mutex.Lock()
	defer wm.mutex.Unlock()

	// Проверяем, не запущен ли уже воркер для этой рассылки
	if worker, exists := wm.workers[mailingID]; exists {
		// Проверяем, действительно ли процесс еще жив
		if worker.Status == "running" && wm.isProcessAlive(worker) {
			return worker, fmt.Errorf("worker for mailing %s already running", mailingID)
		}
		// Если процесс мертв или статус не "running", принудительно очищаем
		if worker.Cmd != nil && worker.Cmd.Process != nil {
			worker.Cmd.Process.Kill() // Убиваем зомби-процесс если есть
		}
		delete(wm.workers, mailingID)
		logrus.WithField("mailing_id", mailingID).Info("Cleaned up stale worker")
	}

	queueName := fmt.Sprintf("mailing_%s", mailingID)

	// Создаем команду для запуска воркера
	cmd := exec.Command(wm.basePath,
		"-mode", "worker",
		"-queue", queueName,
		"-mailing-id", mailingID,
		"-redis-addr", wm.redisAddr,
		"-redis-password", wm.redisPassword,
		"-redis-db", fmt.Sprintf("%d", wm.redisDB),
		"-concurrency", "10", // ИСПРАВЛЯЕМ: Меньше потоков, так как rate limiter теперь общий
		"-total-tasks", fmt.Sprintf("%d", totalTasks), // ИСПРАВЛЯЕМ: Передаем правильное количество задач
	)

	// Настраиваем переменные окружения
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("MAILING_ID=%s", mailingID),
		fmt.Sprintf("QUEUE_NAME=%s", queueName),
		fmt.Sprintf("REDIS_ADDR=%s", wm.redisAddr),
		fmt.Sprintf("REDIS_PASSWORD=%s", wm.redisPassword),
		fmt.Sprintf("REDIS_DB=%d", wm.redisDB),
	)

	// Перенаправляем вывод воркера для логирования
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	// Запускаем процесс
	err := cmd.Start()
	if err != nil {
		return nil, fmt.Errorf("failed to start worker process: %w", err)
	}

	worker := &WorkerProcess{
		MailingID:      mailingID,
		QueueName:      queueName,
		ProcessID:      cmd.Process.Pid,
		Cmd:            cmd,
		StartedAt:      time.Now(),
		Status:         "running",
		TotalTasks:     totalTasks,
		CompletedTasks: 0,
		FailedTasks:    0,
	}

	wm.workers[mailingID] = worker

	// Запускаем горутину для мониторинга процесса
	go wm.monitorWorker(worker)

	logrus.WithFields(logrus.Fields{
		"mailing_id":  mailingID,
		"queue_name":  queueName,
		"process_id":  worker.ProcessID,
		"total_tasks": totalTasks,
	}).Info("Started dedicated worker for mailing")

	return worker, nil
}

// StopWorker останавливает воркер для рассылки
func (wm *WorkerManager) StopWorker(mailingID string) error {
	wm.mutex.Lock()
	worker, exists := wm.workers[mailingID]
	if !exists {
		wm.mutex.Unlock()
		return fmt.Errorf("worker for mailing %s not found", mailingID)
	}

	if worker.Status != "running" {
		wm.mutex.Unlock()
		return fmt.Errorf("worker for mailing %s is not running", mailingID)
	}

	worker.Status = "stopping"
	wm.mutex.Unlock()

	// Отправляем SIGTERM для graceful shutdown
	err := worker.Cmd.Process.Signal(syscall.SIGTERM)
	if err != nil {
		logrus.WithError(err).WithField("mailing_id", mailingID).Warn("Failed to send SIGTERM")
		// Принудительно убиваем процесс
		worker.Cmd.Process.Kill()
	}

	logrus.WithFields(logrus.Fields{
		"mailing_id": mailingID,
		"process_id": worker.ProcessID,
	}).Info("Worker stop signal sent")

	// Ждем завершения процесса в отдельной горутине с таймаутом
	go func() {
		done := make(chan bool, 1)
		go func() {
			worker.Cmd.Wait()
			done <- true
		}()

		select {
		case <-done:
			logrus.WithField("mailing_id", mailingID).Info("Worker stopped gracefully")
		case <-time.After(30 * time.Second):
			logrus.WithField("mailing_id", mailingID).Warn("Worker stop timeout, force killing")
			worker.Cmd.Process.Kill()
		}
	}()

	return nil
}

// GetWorkerStatus возвращает статус воркера
func (wm *WorkerManager) GetWorkerStatus(mailingID string) (*WorkerProcess, error) {
	wm.mutex.RLock()
	defer wm.mutex.RUnlock()

	worker, exists := wm.workers[mailingID]
	if !exists {
		return nil, fmt.Errorf("worker for mailing %s not found", mailingID)
	}

	return worker, nil
}

// GetAllWorkers возвращает список всех воркеров
func (wm *WorkerManager) GetAllWorkers() map[string]*WorkerProcess {
	wm.mutex.RLock()
	defer wm.mutex.RUnlock()

	result := make(map[string]*WorkerProcess)
	for k, v := range wm.workers {
		result[k] = v
	}
	return result
}

// monitorWorker мониторит процесс воркера
func (wm *WorkerManager) monitorWorker(worker *WorkerProcess) {
	// Ждем завершения процесса
	err := worker.Cmd.Wait()

	wm.mutex.Lock()
	defer wm.mutex.Unlock()

	if err != nil {
		logrus.WithError(err).WithFields(logrus.Fields{
			"mailing_id": worker.MailingID,
			"process_id": worker.ProcessID,
		}).Error("Worker process failed")
		worker.Status = "failed"
	} else {
		logrus.WithFields(logrus.Fields{
			"mailing_id": worker.MailingID,
			"process_id": worker.ProcessID,
			"duration":   time.Since(worker.StartedAt).String(),
		}).Info("Worker process completed successfully")
		worker.Status = "stopped"
	}

	// Сразу удаляем воркер из мапы после завершения
	delete(wm.workers, worker.MailingID)
	logrus.WithField("mailing_id", worker.MailingID).Info("Worker removed from active workers list")

	// ПРИМЕЧАНИЕ: Очередь удаляется в самом worker'е для предотвращения дублирования
}

// StopAllWorkers останавливает все активные воркеры
func (wm *WorkerManager) StopAllWorkers() {
	wm.mutex.Lock()
	defer wm.mutex.Unlock()

	for mailingID, worker := range wm.workers {
		if worker.Status == "running" {
			worker.Status = "stopping"
			err := worker.Cmd.Process.Signal(syscall.SIGTERM)
			if err != nil {
				worker.Cmd.Process.Kill()
			}
			logrus.WithField("mailing_id", mailingID).Info("Stopping worker during shutdown")
		}
	}

	// Ждем завершения всех процессов
	timeout := time.After(30 * time.Second)
	done := make(chan bool)

	go func() {
		for _, worker := range wm.workers {
			if worker.Status == "stopping" {
				worker.Cmd.Wait()
			}
		}
		done <- true
	}()

	select {
	case <-done:
		logrus.Info("All workers stopped gracefully")
	case <-timeout:
		logrus.Warn("Timeout waiting for workers to stop, force killing remaining processes")
		for _, worker := range wm.workers {
			if worker.Status == "stopping" {
				worker.Cmd.Process.Kill()
			}
		}
	}
}

// isProcessAlive проверяет, жив ли процесс воркера
func (wm *WorkerManager) isProcessAlive(worker *WorkerProcess) bool {
	if worker.Cmd == nil || worker.Cmd.Process == nil {
		return false
	}

	// Пытаемся отправить signal 0 (проверка существования процесса)
	err := worker.Cmd.Process.Signal(syscall.Signal(0))
	return err == nil
}
