package telegram

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"go-mailing-worker/internal/models"
)

type Client struct {
	token      string
	httpClient *http.Client
}

type TelegramResponse struct {
	OK          bool                   `json:"ok"`
	Result      map[string]interface{} `json:"result,omitempty"`
	ErrorCode   int                    `json:"error_code,omitempty"`
	Description string                 `json:"description,omitempty"`
	Parameters  *ResponseParameters    `json:"parameters,omitempty"`
}

type ResponseParameters struct {
	RetryAfter int `json:"retry_after,omitempty"`
}

func NewClient(token string) *Client {
	return &Client{
		token: token,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *Client) SendTextMessage(chatID, text string, keyboard *models.InlineKeyboard) error {
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", c.token)

	payload := map[string]interface{}{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "HTML",
	}

	if keyboard != nil {
		payload["reply_markup"] = keyboard
	}

	return c.makeAPICall(url, payload)
}

func (c *Client) SendMediaMessage(chatID string, messageData models.MessageData, keyboard *models.InlineKeyboard) error {
	var endpoint string
	var mediaField string

	switch messageData.PostMediaType {
	case "video":
		endpoint = "sendVideo"
		mediaField = "video"
	case "document":
		endpoint = "sendDocument"
		mediaField = "document"
	case "audio":
		endpoint = "sendAudio"
		mediaField = "audio"
	default:
		endpoint = "sendPhoto"
		mediaField = "photo"
	}

	url := fmt.Sprintf("https://api.telegram.org/bot%s/%s", c.token, endpoint)

	// Проверяем, является ли это абсолютным путем или относительным
	mediaPath := messageData.PostMedia
	if !filepath.IsAbs(mediaPath) && !strings.HasPrefix(mediaPath, "http") {
		// Если это относительный путь, добавляем префикс /app/uploads
		mediaPath = "/app/uploads" + mediaPath
	}

	// Проверяем, существует ли файл
	if _, err := os.Stat(mediaPath); os.IsNotExist(err) {
		return fmt.Errorf("media file does not exist: %s", mediaPath)
	}

	// Создаем multipart form
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	// Добавляем chat_id
	writer.WriteField("chat_id", chatID)

	// Добавляем caption если есть
	if messageData.PostContent != "" {
		writer.WriteField("caption", messageData.PostContent)
		writer.WriteField("parse_mode", "HTML")
	}

	// Добавляем клавиатуру если есть
	if keyboard != nil {
		keyboardJSON, _ := json.Marshal(keyboard)
		writer.WriteField("reply_markup", string(keyboardJSON))
	}

	// Добавляем файл
	file, err := os.Open(mediaPath)
	if err != nil {
		return fmt.Errorf("failed to open media file: %w", err)
	}
	defer file.Close()

	part, err := writer.CreateFormFile(mediaField, filepath.Base(mediaPath))
	if err != nil {
		return fmt.Errorf("failed to create form file: %w", err)
	}

	_, err = io.Copy(part, file)
	if err != nil {
		return fmt.Errorf("failed to copy file: %w", err)
	}

	writer.Close()

	// Отправляем запрос
	req, err := http.NewRequest("POST", url, &buf)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	var tgResp TelegramResponse
	if err := json.Unmarshal(respBody, &tgResp); err != nil {
		return fmt.Errorf("failed to parse response: %w", err)
	}

	if !tgResp.OK {
		err := fmt.Errorf("telegram API error: %s", tgResp.Description)

		// Если есть retry_after, добавляем эту информацию в ошибку
		if tgResp.Parameters != nil && tgResp.Parameters.RetryAfter > 0 {
			err = fmt.Errorf("telegram API error (retry after %d): %s",
				tgResp.Parameters.RetryAfter, tgResp.Description)
		}

		return err
	}

	return nil
}

func (c *Client) makeAPICall(url string, payload map[string]interface{}) error {
	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonPayload))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	var tgResp TelegramResponse
	if err := json.Unmarshal(respBody, &tgResp); err != nil {
		return fmt.Errorf("failed to parse response: %w", err)
	}

	if !tgResp.OK {
		// Формируем подробное сообщение об ошибке
		var errMsg strings.Builder
		errMsg.WriteString("telegram API error")
		if tgResp.ErrorCode != 0 {
			errMsg.WriteString(fmt.Sprintf(" %d", tgResp.ErrorCode))
		}
		if tgResp.Description != "" {
			errMsg.WriteString(": ")
			errMsg.WriteString(tgResp.Description)
		}
		if tgResp.Parameters != nil && tgResp.Parameters.RetryAfter > 0 {
			errMsg.WriteString(fmt.Sprintf(" (retry after %d)", tgResp.Parameters.RetryAfter))
		}
		return fmt.Errorf(errMsg.String())
	}

	return nil
}
