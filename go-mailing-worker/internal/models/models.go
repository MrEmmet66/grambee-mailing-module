package models

type MailingRequest struct {
	MailingID      string          `json:"mailing_id" binding:"required"`
	BotToken       string          `json:"bot_token" binding:"required"`
	UsersFileURL   string          `json:"users_file_url" binding:"required"`
	MessageData    MessageData     `json:"message_data" binding:"required"`
	InlineKeyboard *InlineKeyboard `json:"inline_keyboard,omitempty"`
	AdminChatID    string          `json:"admin_chat_id,omitempty"`
	AdminMessageID int             `json:"admin_message_id,omitempty"`
	RateLimit      int             `json:"rate_limit,omitempty"` // сообщений в секунду, по умолчанию 25
}

type MessageData struct {
	Text          string `json:"text,omitempty"`
	PostMedia     string `json:"post_media,omitempty"`
	PostMediaType string `json:"post_media_type,omitempty"` // photo, video, document, etc.
	PostContent   string `json:"post_content,omitempty"`
}

type InlineKeyboard struct {
	InlineKeyboard [][]InlineKeyboardButton `json:"inline_keyboard"`
}

type InlineKeyboardButton struct {
	Text string `json:"text"`
	URL  string `json:"url,omitempty"`
}

type MailingStatus struct {
	MailingID   string `json:"mailing_id"`
	Status      string `json:"status"` // pending, processing, completed, failed
	TotalUsers  int    `json:"total_users"`
	SentCount   int    `json:"sent_count"`
	FailedCount int    `json:"failed_count"`
	RetryCount  int    `json:"retry_count"`
	StartedAt   string `json:"started_at,omitempty"`
	CompletedAt string `json:"completed_at,omitempty"`
	LastError   string `json:"last_error,omitempty"`
}

type User struct {
	UserID   string `json:"user_id"`
	Language string `json:"language,omitempty"`
}

type SendMessageTask struct {
	MailingID      string          `json:"mailing_id"`
	BotToken       string          `json:"bot_token"`
	ChatID         string          `json:"chat_id"`
	MessageData    MessageData     `json:"message_data"`
	InlineKeyboard *InlineKeyboard `json:"inline_keyboard,omitempty"`
	AdminChatID    string          `json:"admin_chat_id,omitempty"`
	AdminMessageID int             `json:"admin_message_id,omitempty"`
	UserIndex      int             `json:"user_index"`
	TotalUsers     int             `json:"total_users"`
	// Метаданные для asynqmon
	CreatedAt string `json:"created_at"`
	Queue     string `json:"queue"`
	Priority  int    `json:"priority"`
}

// TaskResult результат выполнения задачи для asynqmon
type TaskResult struct {
	Success       bool   `json:"success"`
	MailingID     string `json:"mailing_id"`
	ChatID        string `json:"chat_id"`
	UserIndex     int    `json:"user_index"`
	TotalUsers    int    `json:"total_users"`
	APICallTime   int64  `json:"api_call_time_ms"`
	TotalTime     int64  `json:"total_time_ms"`
	FloodWaitTime int64  `json:"flood_wait_time_ms,omitempty"`
	RetryCount    int    `json:"retry_count,omitempty"`
	ErrorMessage  string `json:"error_message,omitempty"`
	CompletedAt   string `json:"completed_at"`
}
