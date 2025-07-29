package testserver

import (
	"io"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// TelegramMockResponse имитирует ответ Telegram API
type TelegramMockResponse struct {
	OK     bool                   `json:"ok"`
	Result map[string]interface{} `json:"result,omitempty"`
}

// StartMockTelegramServer запускает заглушечный сервер на порту 8081
func StartMockTelegramServer() {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()

	// Логируем только ошибки
	r.Use(gin.LoggerWithWriter(io.Discard))
	r.Use(gin.Recovery())

	// Имитируем все Telegram API endpoints
	r.POST("/bot:token/sendMessage", handleMockSendMessage)
	r.POST("/bot:token/sendPhoto", handleMockSendMedia)
	r.POST("/bot:token/sendVideo", handleMockSendMedia)
	r.POST("/bot:token/sendDocument", handleMockSendMedia)
	r.POST("/bot:token/sendAudio", handleMockSendMedia)
	r.GET("/ping", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	logrus.Info("Starting mock Telegram API server on :8081")
	go func() {
		if err := r.Run(":8081"); err != nil {
			logrus.WithError(err).Error("Failed to start mock server")
		}
	}()

	// Даем серверу время запуститься
	time.Sleep(100 * time.Millisecond)
}

func handleMockSendMessage(c *gin.Context) {
	// ТЕСТ: Убираем задержку полностью для максимальной скорости
	// delay := time.Duration(50+rand.Intn(150)) * time.Millisecond
	// time.Sleep(delay)

	// Всегда успешный ответ
	response := TelegramMockResponse{
		OK: true,
		Result: map[string]interface{}{
			"message_id": 12345,
			"date":       time.Now().Unix(),
		},
	}
	c.JSON(200, response)
}

func handleMockSendMedia(c *gin.Context) {
	// ТЕСТ: Убираем задержку полностью для максимальной скорости
	// delay := time.Duration(100+rand.Intn(300)) * time.Millisecond
	// time.Sleep(delay)

	// НЕ читаем multipart form - слишком медленно
	// err := c.Request.ParseMultipartForm(32 << 20) // 32MB

	// Всегда успешный ответ
	response := TelegramMockResponse{
		OK: true,
		Result: map[string]interface{}{
			"message_id": 12345,
			"date":       time.Now().Unix(),
		},
	}
	c.JSON(200, response)
}
