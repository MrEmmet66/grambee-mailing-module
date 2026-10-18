# Dockerfile для Go mailing worker
FROM golang:1.21-alpine AS builder

# Установка необходимых пакетов
RUN apk add --no-cache git ca-certificates tzdata

# Создание рабочей директории
WORKDIR /app

# Копирование go.mod и go.sum для кэширования зависимостей
COPY go.mod go.sum ./

# Загрузка зависимостей
RUN go mod download

# Копирование исходного кода
COPY . .

# Сборка приложения
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main ./cmd/server

# Финальный образ
FROM alpine:latest

# Установка ca-certificates для HTTPS запросов
RUN apk --no-cache add ca-certificates tzdata

WORKDIR /root/

# Копирование скомпилированного приложения
COPY --from=builder /app/main .

# Создание директории для загрузок
RUN mkdir -p /tmp/mailing-worker

# Переменные окружения
ENV GIN_MODE=release
ENV REDIS_ADDR=redis:6379
ENV REDIS_PASSWORD=""
ENV REDIS_DB=0
ENV PORT=8080

# Открытие портов
EXPOSE 8080

# Запуск приложения (по умолчанию в режиме менеджера)
CMD ["./main", "-mode", "manager"]
