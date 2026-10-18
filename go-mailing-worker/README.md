# Go Mailing Worker

Сервис для массовых рассылок через Telegram Bot API с использованием Redis очередей (asynq).

## Особенности

- 🚀 Высокая производительность с использованием Go и Redis
- 📊 Веб-интерфейс мониторинга очередей (asynqmon)
- 🔄 Автоматическая обработка FLOOD_WAIT ошибок
- 📈 Настраиваемый rate limiting
- 🐳 Готов к развертыванию в Docker
- 📱 Поддержка текстовых и медиа сообщений
- 🔗 Поддержка inline клавиатур
- 🤖 Поддержка множественных ботов (токен передается в каждой задаче)

## Быстрый старт

### Локальная разработка

1. Установите зависимости:
```bash
cd go-mailing-worker
go mod tidy
```

2. Скопируйте файл переменных окружения:
```bash
cp .env.example .env
```

3. Настройте переменные в `.env`:
```env
REDIS_ADDR=localhost:6379
PORT=8080
```

4. Запустите Redis (если не используете Docker):
```bash
redis-server
```

5. Запустите сервис:
```bash
go run cmd/server/main.go
```

### Docker

1. Сборка и запуск:
```bash
docker-compose up --build go-mailing-worker
```

## API Эндпоинты

### POST /api/v1/mailing
Создание новой рассылки

```json
{
  "mailing_id": "unique_mailing_id",
  "bot_token": "your_bot_token",
  "users_file_url": "path/to/users.txt",
  "message_data": {
    "text": "Ваше сообщение",
    "post_media": "https://example.com/image.jpg"
  },
  "inline_keyboard": [
    [
      {
        "text": "Кнопка",
        "url": "https://example.com"
      }
    ]
  ],
  "rate_limit": 25,
  "admin_chat_id": "admin_chat_id",
  "admin_message_id": "admin_message_id"
}
```

### GET /api/v1/mailing/{id}/status
Получение статуса рассылки

### GET /api/v1/health
Проверка состояния сервиса

### GET /monitoring/*
Веб-интерфейс asynqmon для мониторинга очередей

## Формат файла пользователей

Файл должен содержать по одному пользователю на строку:
```
123456789
987654321:en
555666777:ru
```

Формат: `user_id` или `user_id:language_code`

## Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `REDIS_ADDR` | Адрес Redis сервера | `localhost:6379` |
| `REDIS_PASSWORD` | Пароль Redis | `` |
| `REDIS_DB` | Номер базы Redis | `0` |
| `PORT` | Порт HTTP сервера | `8080` |
| `GIN_MODE` | Режим Gin (debug/release) | `debug` |

**Примечание:** Токен бота передается в каждом запросе рассылки через поле `bot_token` в JSON, что позволяет использовать разные боты для разных рассылок.

## Мониторинг

Веб-интерфейс asynqmon доступен по адресу: `http://localhost:8080/monitoring`

Здесь вы можете:
- Просматривать активные задачи
- Мониторить производительность
- Управлять очередями
- Просматривать ошибки и повторы

## Обработка ошибок

Сервис автоматически обрабатывает FLOOD_WAIT ошибки от Telegram API:
- Парсит время ожидания из ответа API
- Автоматически планирует повтор задачи
- Логирует все операции для отладки

## Архитектура

```
go-mailing-worker/
├── cmd/server/         # Точка входа приложения
├── internal/
│   ├── handlers/       # HTTP обработчики
│   ├── models/         # Модели данных
│   ├── tasks/          # Обработчики задач asynq
│   ├── telegram/       # Клиент Telegram API
│   ├── utils/          # Утилиты
│   └── worker/         # Конфигурация воркера
├── Dockerfile          # Docker образ
└── go.mod             # Go модуль
```

## Производительность

- Поддержка до 10 параллельных воркеров
- Настраиваемый rate limiting (по умолчанию 25 сообщений/сек)
- Приоритетные очереди (critical, default, low)
- Автоматические повторы с экспоненциальной задержкой

## Лицензия

MIT License
