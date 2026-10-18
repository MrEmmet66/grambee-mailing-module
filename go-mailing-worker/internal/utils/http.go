package utils

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/sirupsen/logrus"
)

// CompleteMailingRequest структура для отправки данных о завершении рассылки на бекенд
type CompleteMailingRequest struct {
	QueueName   string `json:"queueName"`
	SentCount   int    `json:"sentCount"`
	FailedCount int    `json:"failedCount"`
}

// SendMailingCompletion отправляет уведомление о завершении рассылки на бекенд
func SendMailingCompletion(backendURL, queueName string, processed, failed int) error {
	// sentCount = processed - failed (как указано в требованиях)
	sentCount := processed - failed
	if sentCount < 0 {
		sentCount = 0 // На всякий случай, чтобы не было отрицательных значений
	}

	requestData := CompleteMailingRequest{
		QueueName:   queueName,
		SentCount:   sentCount,
		FailedCount: failed,
	}

	jsonData, err := json.Marshal(requestData)
	if err != nil {
		return fmt.Errorf("failed to marshal request data: %w", err)
	}

	// Создаем HTTP клиент с разумным таймаутом
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	// Отправляем POST запрос на endpoint /processor/finish
	url := fmt.Sprintf("%s/processor/finish", backendURL)
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	secret := os.Getenv("SECRET_KEY")
	if secret == "" {
		return fmt.Errorf("SECRET_KEY is required for completion callbacks")
	}
	req.Header.Set("x-request-secret", secret)
	req.Header.Set("Content-Type", "application/json")

	logrus.WithFields(logrus.Fields{
		"url":          url,
		"queue_name":   queueName,
		"sent_count":   sentCount,
		"failed_count": failed,
		"processed":    processed,
	}).Info("Sending mailing completion callback to backend")

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("backend returned error status: %d", resp.StatusCode)
	}

	logrus.WithFields(logrus.Fields{
		"queue_name":   queueName,
		"sent_count":   sentCount,
		"failed_count": failed,
		"status_code":  resp.StatusCode,
	}).Info("Mailing completion callback sent successfully")

	return nil
}
