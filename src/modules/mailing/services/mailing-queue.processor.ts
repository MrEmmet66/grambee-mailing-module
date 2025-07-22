import { Injectable } from '@nestjs/common';
import * as Bull from 'bull';
import { TelegramService } from '../../telegram/telegram.service';
import { ReservationService } from './reservation.service';

// Интерфейс для FLOOD_WAIT события
export interface FloodWaitEvent {
    timestamp: number; // Unix timestamp когда возник FLOOD_WAIT
    retryAfter: number; // Время ожидания в секундах
    queueName: string; // Имя очереди где произошел FLOOD_WAIT
}

@Injectable()
export class MailingQueueWorker {
    private sentCounters: Record<string, number> = {};
    private failCounters: Record<string, number> = {};
    private updateIntervals: Record<string, number> = {};
    private totalUsers: Record<string, number> = {};
    private sourceMessages: Record<string, { chatId: number, messageId: number }> = {};
    private useCopyMode: Record<string, boolean> = {};
    private queues: Record<string, Bull.Queue> = {}; // Кэш очередей

    /**
     * Получить очередь по имени (для мониторинга/метрик)
     */
    public getQueueByName(queueName: string): Bull.Queue | undefined {
        return this.queues[queueName];
    }

    /**
     * Получить историю FLOOD_WAIT событий для указанной очереди
     * @param queueName - Имя очереди
     * @returns Массив FLOOD_WAIT событий (максимум 5 последних)
     */
    public getFloodWaitHistory(queueName: string): FloodWaitEvent[] {
        return this.floodWaitHistory[queueName] || [];
    }

    /**
     * Получить историю FLOOD_WAIT событий для всех очередей
     * @returns Объект с историей для каждой очереди
     */
    public getAllFloodWaitHistory(): Record<string, FloodWaitEvent[]> {
        return { ...this.floodWaitHistory };
    }

    private jobsAdded: Record<string, number> = {}; // Счётчик добавленных джобов
    private jobsProcessed: Record<string, number> = {}; // Счётчик обработанных джобов
    private startTime: Record<string, number> = {}; // Время начала обработки для расчета скорости
    private retryJobs: Record<string, number> = {}; // Счётчик retry jobs (FLOOD_WAIT)
    private queueCompleted: Record<string, boolean> = {}; // Флаг завершения очереди
    private activeJobs: Record<string, number> = {}; // Счётчик активных джобов для мониторинга concurrency
    private currentSpeeds: Record<string, number> = {}; // Текущая скорость (concurrency)
    private lastSpeedLimit: Record<string, number> = {}; // Время последнего изменения скорости
    private maxSpeeds: Record<string, number> = {}; // Максимальная скорость для каждого бота (адаптивно снижается при FLOOD_WAIT)
    private floodWaitHistory: Record<string, FloodWaitEvent[]> = {}; // История FLOOD_WAIT событий для каждой очереди (макс 5 событий)
    private processedPerSecond: Record<string, number[]> = {}; // Количество обработанных сообщений за каждую секунду (последние 60 секунд)
    private lastSecondTimestamp: Record<string, number> = {}; // Timestamp последней секунды
    private lastJobTime: Record<string, number> = {}; // Время последнего выполнения job для rate limiting
    private rateLimiterMutex: Record<string, Promise<void>> = {}; // Мьютекс для синхронизации rate limiter

    constructor(
        private readonly telegramService: TelegramService,
        private readonly mailingReservationsService: ReservationService
    ) { }

    /**
     * Добавить FLOOD_WAIT событие в историю
     * @param queueName - Имя очереди
     * @param retryAfter - Время ожидания в секундах
     */
    private addFloodWaitEvent(queueName: string, retryAfter: number): void {
        if (!this.floodWaitHistory[queueName]) {
            this.floodWaitHistory[queueName] = [];
        }

        const now = Date.now();
        // Проверяем, есть ли похожий FLOOD_WAIT за последние 3 секунды
        const recentDuplicate = this.floodWaitHistory[queueName].find(ev =>
            Math.abs(now - ev.timestamp) < 3000 && ev.retryAfter === retryAfter
        );
        if (recentDuplicate) {
            // Дубликат, не добавляем
            console.log(`[${queueName}] FLOOD_WAIT duplicate detected, not adding: retry_after=${retryAfter}s, at_time=${new Date(now).toISOString()}`);
            return;
        }

        const event: FloodWaitEvent = {
            timestamp: now, // Сохраняем реальное время возникновения FLOOD_WAIT
            retryAfter: retryAfter,
            queueName: queueName
        };

        // Добавляем новое событие в начало массива
        this.floodWaitHistory[queueName].unshift(event);

        // Ограничиваем до 5 последних событий
        if (this.floodWaitHistory[queueName].length > 5) {
            this.floodWaitHistory[queueName] = this.floodWaitHistory[queueName].slice(0, 5);
        }

        console.log(`[${queueName}] FLOOD_WAIT event recorded: retry_after=${retryAfter}s, at_time=${new Date(event.timestamp).toISOString()}, total events: ${this.floodWaitHistory[queueName].length}`);
    }

    /**
     * Проверяет и ждет, если нужно, для соблюдения заданной скорости
     * @param queueName - Имя очереди
     */
    private async rateLimitWait(queueName: string): Promise<void> {
        // Ждем освобождения мьютекса, если он уже заблокирован
        while (this.rateLimiterMutex[queueName]) {
            await this.rateLimiterMutex[queueName];
        }

        // Создаем новую блокировку
        let resolveMutex: () => void;
        this.rateLimiterMutex[queueName] = new Promise<void>((resolve) => {
            resolveMutex = resolve;
        });

        try {
            const currentSpeed = this.currentSpeeds[queueName] || 25;
            const lastJobTime = this.lastJobTime[queueName] || 0;
            const now = Date.now();
            
            // Минимальный интервал между jobs в миллисекундах
            const minInterval = 1000 / currentSpeed;
            
            // Время, прошедшее с последнего job
            const timeSinceLastJob = now - lastJobTime;
            
            // Если прошло меньше минимального интервала, ждем
            if (timeSinceLastJob < minInterval) {
                const waitTime = minInterval - timeSinceLastJob;
                console.log(`[${queueName}] [RATE LIMIT] Waiting ${Math.round(waitTime)}ms (speed: ${currentSpeed} msg/sec, timeSince: ${Math.round(timeSinceLastJob)}ms, minInterval: ${Math.round(minInterval)}ms)`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            } else {
                console.log(`[${queueName}] [RATE LIMIT] No wait needed (speed: ${currentSpeed} msg/sec, timeSince: ${Math.round(timeSinceLastJob)}ms, minInterval: ${Math.round(minInterval)}ms)`);
            }
            
            // Обновляем время последнего job
            this.lastJobTime[queueName] = Date.now();
        } finally {
            // Освобождаем мьютекс
            resolveMutex!();
            delete this.rateLimiterMutex[queueName];
        }
    }

    /**
     * Обновляет счетчик скорости обработки сообщений по секундам
     */
    private updateProcessingSpeed(queueName: string): void {
        const currentSecond = Math.floor(Date.now() / 1000);
        const lastSecond = this.lastSecondTimestamp[queueName];
        
        if (!this.processedPerSecond[queueName]) {
            this.processedPerSecond[queueName] = [];
        }
        
        // Если прошла новая секунда
        if (currentSecond > lastSecond) {
            // Заполняем пропущенные секунды нулями (если были паузы)
            const missedSeconds = currentSecond - lastSecond - 1;
            for (let i = 0; i < missedSeconds && i < 60; i++) {
                this.processedPerSecond[queueName].push(0);
            }
            
            // Добавляем новую секунду с одним обработанным сообщением
            this.processedPerSecond[queueName].push(1);
            this.lastSecondTimestamp[queueName] = currentSecond;
        } else {
            // Увеличиваем счетчик для текущей секунды
            const currentIndex = this.processedPerSecond[queueName].length - 1;
            if (currentIndex >= 0) {
                this.processedPerSecond[queueName][currentIndex]++;
            } else {
                this.processedPerSecond[queueName].push(1);
            }
        }
        
        // Ограничиваем историю последними 60 секундами
        if (this.processedPerSecond[queueName].length > 60) {
            this.processedPerSecond[queueName] = this.processedPerSecond[queueName].slice(-60);
        }
    }

    async startWorker(queueName: string, redisConfig: any, reservationId?: number, totalUsers: number = 0) {

        // Если очередь уже существует, возвращаем её (и не трогаем jobs)
        if (this.queues[queueName]) {
            console.log(`[MailingQueueWorker] Queue ${queueName} already exists, returning existing queue`);
            return this.queues[queueName];
        }

        console.log(`[MailingQueueWorker] Creating new queue ${queueName} with Redis config:`, {
            host: redisConfig.host,
            port: redisConfig.port,
            hasPassword: !!redisConfig.password
        });

        // Создаем более безопасную конфигурацию Redis
        const safeRedisConfig = {
            host: redisConfig.host,
            port: redisConfig.port,
            ...(redisConfig.password && redisConfig.password.trim() ? { password: redisConfig.password } : {}),
            connectTimeout: 30000,
            maxRetriesPerRequest: null,
            enableOfflineQueue: true,
            retryDelayOnFailure: 100,
        };

        let queue;
        // Начальная скорость (25 сообщений в секунду)
        const initialSpeed = 25;
        // Устанавливаем максимальный лимит в Bull.js, так как у нас свой rate limiter
        const bullLimiterMax = 1000; // Очень высокий лимит, чтобы Bull.js не ограничивал
        try {
            queue = new Bull(queueName, {
                redis: safeRedisConfig,
                limiter: { max: bullLimiterMax, duration: 1000 },
                defaultJobOptions: {
                    removeOnComplete: 100,
                    removeOnFail: 100,
                    attempts: 5,
                    backoff: {
                        type: 'fixed',
                        delay: 100,
                    },
                },
                settings: {
                    stalledInterval: 30000,
                    maxStalledCount: 1,
                }
            });

            // Инициализируем адаптивную скорость
            this.currentSpeeds[queueName] = initialSpeed;
            this.lastSpeedLimit[queueName] = Date.now(); // Устанавливаем текущее время для корректной работы адаптации
            this.maxSpeeds[queueName] = 50; // Изначально максимальная скорость

            // Ждем готовности Redis соединения
            console.log(`[MailingQueueWorker] Waiting for Redis connection...`);
            await queue.isReady();
            console.log(`[MailingQueueWorker] Redis connection established`);
            
            // Логируем текущие настройки limiter для отладки (после инициализации)
            console.log(`[MailingQueueWorker] Queue ${queueName} Bull.js limiter: ${bullLimiterMax} msg/sec (disabled - using custom rate limiter)`);
            console.log(`[MailingQueueWorker] Custom rate limiter: initial speed: ${initialSpeed}, max speed: ${this.maxSpeeds[queueName]}`);
        } catch (error) {
            console.error(`[MailingQueueWorker] Failed to create queue ${queueName}:`, error);
            throw error;
        }

        console.log(`[MailingQueueWorker] Queue ${queueName} created successfully`);

        // Добавляем обработчики ошибок Redis
        queue.on('error', (error) => {
            console.error(`[MailingQueueWorker] Queue ${queueName} error:`, error);
        });

        queue.on('stalled', (job) => {
            console.warn(`[MailingQueueWorker] Job ${job.id} stalled in queue ${queueName}`);
        });


        queue.client.on('connect', () => {
            console.log(`[MailingQueueWorker] Redis client connected for queue ${queueName}`);
        });

        queue.client.on('error', (error) => {
            console.error(`[MailingQueueWorker] Redis client error for queue ${queueName}:`, error);
        });

        queue.client.on('close', () => {
            console.warn(`[MailingQueueWorker] Redis client disconnected for queue ${queueName}`);
        });

        // Сохраняем очередь в кэш
        this.queues[queueName] = queue;
        // ВАЖНО: Не чистим очередь! Очистка jobs убирает все задания, которые только что были добавлены.
        // Если нужно чистить очередь, делайте это только явно, до добавления jobs, и только для новых рассылок.

        this.sentCounters[queueName] = 0;
        this.failCounters[queueName] = 0;
        this.totalUsers[queueName] = totalUsers;
        this.jobsAdded[queueName] = 0;
        this.jobsProcessed[queueName] = 0;
        this.useCopyMode[queueName] = false; // Начинаем всегда с режима send
        this.startTime[queueName] = Date.now(); // Засекаем время начала для расчета скорости
        this.retryJobs[queueName] = 0; // Счётчик retry jobs
        this.queueCompleted[queueName] = false; // Флаг завершения
        this.activeJobs[queueName] = 0; // Счётчик активных джобов
        this.floodWaitHistory[queueName] = []; // История FLOOD_WAIT событий
        this.processedPerSecond[queueName] = []; // Инициализируем отслеживание скорости
        this.lastSecondTimestamp[queueName] = Math.floor(Date.now() / 1000); // Текущая секунда
        
        // Переключаемся на copy mode после первых 10 сообщений для оптимального использования лимитов
        const switchToCopyAfter = Math.min(10, Math.ceil(totalUsers * 0.001));
        console.log(`[MailingQueueWorker] Will switch to copy mode after ${switchToCopyAfter} successful sends for optimal throughput (~50 msg/sec)`);

        const updateEvery = Math.ceil(totalUsers / 100) || 1;
        this.updateIntervals[queueName] = updateEvery;

        if (reservationId) {
            await this.mailingReservationsService.createQueueRecord(reservationId, queueName, totalUsers);
        }

        // Handle both named 'sendMessage' jobs and default jobs for backward compatibility
        const processJob = async (job) => {
            // Увеличиваем счётчик активных джобов
            this.activeJobs[queueName] = (this.activeJobs[queueName] || 0) + 1;
            
            try {
                // Проверяем, что очередь еще активна (не была удалена)
                if (!this.queues[queueName] || this.queueCompleted[queueName]) {
                    console.log(`[MailingQueueWorker] Queue ${queueName} was already closed or completed, skipping job ${job.id}`);
                    return;
                }
                
                // Проверяем, что все счетчики еще существуют
                if (this.sentCounters[queueName] === undefined || this.failCounters[queueName] === undefined || this.jobsProcessed[queueName] === undefined) {
                    console.log(`[MailingQueueWorker] Queue ${queueName} counters are undefined, skipping job ${job.id}`);
                    return;
                }
            
                console.log(`[MailingQueueWorker] Processing job for queue ${queueName}, job ID: ${job.id}, job name: ${job.name || '__default__'}`);
                
                // Применяем custom rate limiting
                await this.rateLimitWait(queueName);
                
                const {
                    botToken, chatId, text, inlineKeyboard,
                    isChannel, reservationId, adminChatId, adminMessageId
                } = job.data;

                // Проверяем, что все необходимые данные присутствуют
                if (!botToken || !chatId) {
                    console.error(`[MailingQueueWorker] Missing required job data for job ${job.id}:`, { botToken: !!botToken, chatId });
                    if (this.jobsProcessed[queueName] !== undefined) {
                        this.jobsProcessed[queueName]++;
                        this.checkAndCompleteQueue(queueName, reservationId);
                    }
                    return;
                }

                const useCopy = this.useCopyMode?.[queueName] ?? false;
                // Приоритет: данные из job, затем кэш
                const source = (adminChatId && adminMessageId) 
                    ? { chatId: Number(adminChatId), messageId: adminMessageId }
                    : this.sourceMessages?.[queueName];

                // Убираем лишние логи для ускорения в copy режиме
                if (!useCopy || this.sentCounters[queueName] % 100 === 0) {
                    console.log(`[${queueName}] Processing user ${chatId} in ${useCopy ? 'copy' : 'send'} mode, has source: ${!!source}`);
                }
                
                // Дополнительное логирование режима перед каждым API вызовом
                console.log(`[${queueName}] About to make API call for user ${chatId}:`, {
                    mode: useCopy ? 'copy' : 'send',
                    copyModeEnabled: this.useCopyMode[queueName],
                    hasSource: !!source,
                    sourceDetails: source,
                    willUseApi: useCopy && source ? 'copyMessage' : 'sendTextMessage'
                });

                try {
                    const startTime = Date.now(); // Засекаем время выполнения
                    let apiCallTime = 0;
                    let apiCallType = '';
                    let apiError = null;
                    let apiStart = 0;
                    try {
                        if (job.data.postMedia) {
                            const mailing = {
                                postMedia: job.data.postMedia,
                                postMediaType: job.data.postMediaType || 'photo',
                                postContent: job.data.text || '',
                            };
                            apiCallType = 'sendMediaMessage';
                            apiStart = Date.now();
                            await this.telegramService.sendMediaMessage(
                                botToken,
                                chatId,
                                mailing,
                                inlineKeyboard
                            );
                            apiCallTime = Date.now() - apiStart;
                        } else if (useCopy && source) {
                            apiCallType = 'copyMessage';
                            apiStart = Date.now();
                            await this.telegramService.copyMessage(
                                botToken,
                                String(source.chatId),
                                source.messageId,
                                chatId,
                                inlineKeyboard
                            );
                            apiCallTime = Date.now() - apiStart;
                        } else {
                            if (useCopy && !source) {
                                console.log(`[${queueName}] Copy mode requested but no source message available, falling back to send mode for user ${chatId}`);
                            }
                            apiCallType = 'sendTextMessage';
                            apiStart = Date.now();
                            await this.telegramService.sendTextMessage(
                                botToken,
                                chatId,
                                text,
                                inlineKeyboard
                            );
                            apiCallTime = Date.now() - apiStart;
                        }
                    } catch (apiErr) {
                        apiCallTime = apiStart ? (Date.now() - apiStart) : 0;
                        apiError = apiErr;
                        // Логируем время даже при ошибке
                        console.log(`[${queueName}] [API TIME] ${apiCallType || 'API ERROR'} for user ${chatId}: ${apiCallTime}ms (error)`);
                        throw apiErr;
                    }
                    // Логируем время при успехе
                    if (apiCallType) {
                        console.log(`[${queueName}] [API TIME] ${apiCallType} for user ${chatId}: ${apiCallTime}ms`);
                    }
                    const executionTime = Date.now() - startTime;

                    // Логируем медленные запросы с детализацией
                    if (executionTime > 500 || apiCallTime > 400) {
                        console.log(`[${queueName}] Slow ${useCopy ? 'copy' : 'send'} request: total=${executionTime}ms, api=${apiCallTime}ms for user ${chatId}`);
                    }

                    // Счётчик успешных
                    this.sentCounters[queueName]++;
                    this.jobsProcessed[queueName]++;
                    
                    // Обновляем счетчик скорости обработки
                    this.updateProcessingSpeed(queueName);
                    
                    // Умное переключение на copy mode после первых успешных отправок для увеличения throughput
                    const switchToCopyAfter = Math.min(10, Math.ceil(this.totalUsers[queueName] * 0.001));
                    if (!this.useCopyMode[queueName] && this.sentCounters[queueName] >= switchToCopyAfter && (source || this.sourceMessages?.[queueName])) {
                        this.useCopyMode[queueName] = true;
                        console.log(`[${queueName}] Switched to copy mode after ${this.sentCounters[queueName]} sends. Copy mode may have different performance characteristics.`);
                    }
                    
                    // Каждые 50 сообщений показываем объединенную статистику
                    if (this.sentCounters[queueName] % 50 === 0) {
                        const elapsed = (Date.now() - this.startTime[queueName]) / 1000;
                        const speed = Math.round(this.sentCounters[queueName] / elapsed);
                        const currentMode = this.useCopyMode[queueName] ? 'copy' : 'send';
                        const activeJobsCount = this.activeJobs[queueName] || 0;
                        const currentSpeedLimit = this.currentSpeeds[queueName] || initialSpeed;
                        const maxSpeed = this.maxSpeeds[queueName] || 50;
                        const actualSpeed = this.getActualProcessingSpeed(queueName);
                        const avgSpeed = this.getAverageProcessingSpeed(queueName, 5);
                        
                        console.log(`[${queueName}] Speed: ${speed} msg/sec, sent: ${this.sentCounters[queueName]}, processed: ${this.jobsProcessed[queueName]}/${this.jobsAdded[queueName]}, retries: ${this.retryJobs[queueName]}, mode: ${currentMode}, limit: ${currentSpeedLimit}/${maxSpeed}, active_jobs: ${activeJobsCount}, actual: ${actualSpeed}/sec, avg5s: ${avgSpeed}/sec, conn_pool: limited to 8 per bot`);
                    }
                    
                    // Оптимизация: обновляем БД реже для большей скорости
                    if (this.sentCounters[queueName] % this.updateIntervals[queueName] === 0) {
                        // Делаем обновление БД асинхронно, чтобы не блокировать обработку
                        this.mailingReservationsService.incrementQueueSent(queueName, this.updateIntervals[queueName])
                            .catch(err => console.error(`[${queueName}] Failed to update sent count:`, err));
                    }

                    // Проверяем, завершились ли все задачи
                    this.checkAndCompleteQueue(queueName, reservationId);

                } catch (e) {
                    let isFloodWait = false;
                    let waitSeconds = 1;
                    let errorMessage = e?.message || 'Unknown error';
                    
                    // Логируем полную ошибку для диагностики
                    const currentMode = this.useCopyMode[queueName] ? 'copy' : 'send';
                    console.log(`[${queueName}] API Error in ${currentMode} mode for user ${chatId}:`, {
                        fullError: e,
                        errorMessage: errorMessage,
                        errorCode: e?.code,
                        errorStatus: e?.status,
                        errorResponse: e?.response?.data || e?.response,
                        hasSource: !!source,
                        copyModeEnabled: this.useCopyMode[queueName]
                    });

                    // Попытаемся парсить JSON ответ от Telegram API
                    try {
                        if (errorMessage.includes('Failed to send message:')) {
                            const jsonMatch = errorMessage.match(/\{.*\}/);
                            if (jsonMatch) {
                                const telegramError = JSON.parse(jsonMatch[0]);
                                console.log(`[${queueName}] Parsed Telegram API error:`, telegramError);
                                
                                if (telegramError.error_code === 429) {
                                    isFloodWait = true;
                                    // Извлекаем динамическое значение retry_after
                                    waitSeconds = telegramError.parameters?.retry_after || 10;
                                }
                            }
                        }
                    } catch (parseError) {
                        console.log(`[${queueName}] Failed to parse Telegram error JSON:`, parseError);
                    }

                    // Проверяем различные форматы флуд-вейта в тексте ошибки
                    if (!isFloodWait && typeof errorMessage === 'string') {
                        // Формат: FLOOD_WAIT_X
                        const waitMatch1 = errorMessage.match(/FLOOD_WAIT_(\d+)/i);
                        if (waitMatch1) {
                            isFloodWait = true;
                            waitSeconds = parseInt(waitMatch1[1], 10) || 1;
                        }

                        // Формат: Too Many Requests: retry after X
                        const waitMatch2 = errorMessage.match(/retry after (\d+)/i);
                        if (waitMatch2) {
                            isFloodWait = true;
                            waitSeconds = parseInt(waitMatch2[1], 10) || 1;
                            
                            console.log(`[${queueName}] Detected 'retry after' pattern in ${currentMode} mode:`, {
                                extractedWaitSeconds: waitSeconds,
                                originalError: errorMessage
                            });
                        }

                        // Проверяем также код ошибки 429
                        if ((errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) && !waitMatch2) {
                            isFloodWait = true;
                            waitSeconds = 10; // Значение по умолчанию для 429 ошибки
                            
                            console.log(`[${queueName}] Detected 429/Too Many Requests in ${currentMode} mode without explicit retry_after:`, {
                                defaultWaitSeconds: waitSeconds,
                                originalError: errorMessage
                            });
                        }
                    }

                    if (isFloodWait) {
                        const currentMode = this.useCopyMode[queueName] ? 'copy' : 'send';
                        console.log(`[${queueName}] FLOOD_WAIT detected for user ${chatId}, pausing queue for ${waitSeconds}s`);

                        // Записываем FLOOD_WAIT событие в историю
                        this.addFloodWaitEvent(queueName, waitSeconds);

                        // --- ПАУЗИМ ВСЮ ОЧЕРЕДЬ НА ВРЕМЯ FLOOD_WAIT ---
                        console.log(`[${queueName}] Pausing entire queue for ${waitSeconds} seconds due to FLOOD_WAIT`);
                        await queue.pause();
                        
                        // Устанавливаем таймер для возобновления очереди
                        setTimeout(async () => {
                            try {
                                await queue.resume();
                                console.log(`[${queueName}] Queue resumed after ${waitSeconds}s FLOOD_WAIT pause`);
                            } catch (resumeError) {
                                console.error(`[${queueName}] Error resuming queue:`, resumeError);
                            }
                        }, waitSeconds * 1000);

                        // --- Адаптивное снижение скорости (более агрессивно: на 2) ---
                        const drop = 2; // шаг уменьшения скорости
                        const minSpeed = 15;
                        const now = Date.now();
                        
                        // Защита от частых изменений скорости (как в Python: last_speed_limit + 5 >= time_now)
                        if (!this.lastSpeedLimit[queueName] || now - this.lastSpeedLimit[queueName] >= 5000) {
                            let currentSpeed = this.currentSpeeds[queueName] || initialSpeed;
                            let maxSpeed = this.maxSpeeds[queueName] || 50;
                            
                            if (currentSpeed > minSpeed) {
                                const prevSpeed = currentSpeed;
                                const prevMaxSpeed = maxSpeed;
                                
                                // Снижаем текущую скорость
                                currentSpeed = Math.max(minSpeed, currentSpeed - drop);
                                this.currentSpeeds[queueName] = currentSpeed;
                                
                                // Снижаем максимальную скорость на 2 (запоминаем лимит бота)
                                maxSpeed = Math.max(minSpeed, maxSpeed - 2);
                                this.maxSpeeds[queueName] = maxSpeed;
                                
                                this.lastSpeedLimit[queueName] = now;
                                
                                console.log(`[${queueName}] [ADAPTIVE] FLOOD_WAIT: speed ${prevSpeed} → ${currentSpeed}, maxSpeed ${prevMaxSpeed} → ${maxSpeed} msg/sec`);
                            }
                        }

                        // Увеличиваем счётчик retry jobs
                        this.retryJobs[queueName]++;

                        // Добавляем retry job БЕЗ задержки (очередь уже на паузе)
                        await queue.add({
                            botToken,
                            chatId,
                            text,
                            inlineKeyboard,
                            isChannel,
                            reservationId,
                            adminChatId,
                            adminMessageId,
                        });

                        // НЕ увеличиваем jobsProcessed для FLOOD_WAIT - job будет повторен
                        console.log(`[${queueName}] Added retry job for user ${chatId}, queue paused for ${waitSeconds}s, total retries: ${this.retryJobs[queueName]}, current speed: ${this.currentSpeeds[queueName]}`);
                        return;
                    }
                    
                    // Обычная ошибка (не FLOOD_WAIT)
                    console.error(`[${queueName}] Failed to send message to user ${chatId}:`, errorMessage);
                    
                    // Проверяем, что счетчики еще существуют перед их обновлением
                    if (this.failCounters[queueName] !== undefined && this.sentCounters[queueName] !== undefined && this.updateIntervals[queueName] !== undefined) {
                        console.log(`[${queueName}] Error details:`, {
                            failedCount: this.failCounters[queueName] + 1,
                            sentCount: this.sentCounters[queueName],
                            updateInterval: this.updateIntervals[queueName]
                        });

                        this.failCounters[queueName]++;
                        if (this.failCounters[queueName] % this.updateIntervals[queueName] === 0) {
                            // Делаем обновление БД асинхронно
                            this.mailingReservationsService.incrementQueueFailed(queueName, this.updateIntervals[queueName])
                                .catch(err => console.error(`[${queueName}] Failed to update failed count:`, err));
                        }

                        this.jobsProcessed[queueName]++;
                        
                        // Обновляем счетчик скорости обработки
                        this.updateProcessingSpeed(queueName);
                        
                        console.log(`[${queueName}] Job failed for user ${chatId}. Total failed: ${this.failCounters[queueName]}, Processed: ${this.jobsProcessed[queueName]}/${this.jobsAdded[queueName]}, Retries: ${this.retryJobs[queueName]}`);
                        // Проверяем, завершились ли все задачи
                        this.checkAndCompleteQueue(queueName, reservationId);
                    } else {
                        console.log(`[${queueName}] Counters are undefined, skipping error processing for user ${chatId}`);
                    }
                }
                
                // --- УНИВЕРСАЛЬНАЯ АДАПТИВНАЯ ЛОГИКА (работает для успешных И неудачных сообщений) ---
                // Каждые 50 обработанных сообщений проверяем возможность увеличения скорости
                if (this.jobsProcessed[queueName] % 50 === 0 && this.jobsProcessed[queueName] > 0) {
                    const maxSpeed = this.maxSpeeds[queueName] || 50; // Используем адаптивную максимальную скорость
                    let currentSpeed = this.currentSpeeds[queueName] || initialSpeed;
                    
                    // Проверяем последнее FLOOD_WAIT событие для этой очереди
                    const lastFloodWait = this.floodWaitHistory[queueName]?.[0];
                    
                    // Рассчитываем интервал увеличения скорости на основе общего количества пользователей
                    const totalUsers = this.totalUsers[queueName] || 1000;
                    const speedIncreaseInterval = Math.max(100, Math.ceil(totalUsers / 100)); // Минимум каждые 100 сообщений
                    
                    // Проверяем количество сообщений с момента последнего FLOOD_WAIT (используем время для FLOOD_WAIT)
                    let messagesSinceLastFloodWait = this.jobsProcessed[queueName];
                    if (lastFloodWait) {
                        const timeSinceFloodWait = Date.now() - lastFloodWait.timestamp;
                        messagesSinceLastFloodWait = Math.floor(timeSinceFloodWait / 1000); // Примерная оценка сообщений по времени
                    }
                    
                    // Условия для увеличения скорости:
                    // 1. Прошло достаточно сообщений с момента запуска (speedIncreaseInterval)
                    // 2. Если был FLOOD_WAIT, то прошло достаточно времени (минимум 60 секунд)
                    const messagesCondition = this.jobsProcessed[queueName] % speedIncreaseInterval === 0;
                    const floodWaitCondition = lastFloodWait ? 
                        (Date.now() - lastFloodWait.timestamp) >= 60000 : // 60 секунд после FLOOD_WAIT
                        true;
                    
                    const canIncreaseSpeed = messagesCondition && floodWaitCondition && currentSpeed < maxSpeed;
                    
                    // Отладочное логирование для понимания, почему скорость не увеличивается
                    const timeSinceFloodWait = lastFloodWait ? 
                        `${Math.floor((Date.now() - lastFloodWait.timestamp) / 1000)}s ago` : 
                        'never';
                    
                    console.log(`[${queueName}] [ADAPTIVE DEBUG] Speed check: current=${currentSpeed}, max=${maxSpeed}, processed=${this.jobsProcessed[queueName]}, interval=${speedIncreaseInterval}, lastFloodWait=${timeSinceFloodWait}, canIncrease=${canIncreaseSpeed}`);
                    
                    if (canIncreaseSpeed) {
                        currentSpeed = Math.min(maxSpeed, currentSpeed + 1);
                        this.currentSpeeds[queueName] = currentSpeed;
                        this.lastSpeedLimit[queueName] = Date.now(); // Обновляем время для логирования
                        
                        console.log(`[${queueName}] [ADAPTIVE] Speed increased to ${currentSpeed} msg/sec (last FLOOD_WAIT: ${timeSinceFloodWait}, max: ${maxSpeed})`);
                    }
                }
            } catch (outerError) {
                // Обработка ошибки во внешнем блоке
                console.error(`[${queueName}] Outer error processing job ${job.id}:`, outerError);
                
                // Увеличиваем счётчик обработанных джобов
                if (this.jobsProcessed[queueName] !== undefined) {
                    this.jobsProcessed[queueName]++;
                    this.checkAndCompleteQueue(queueName, reservationId);
                }
            } finally {
                // Уменьшаем счётчик активных джобов
                this.activeJobs[queueName] = Math.max(0, (this.activeJobs[queueName] || 0) - 1);
            }
        };

        // Увеличиваем concurrency для большей скорости (например, до 32 или до maxSpeeds)
        const concurrency = Math.max(16, Math.min(64, this.maxSpeeds[queueName] || 50));
        console.log(`[MailingQueueWorker] Setting up queue processor for ${queueName} with concurrency ${concurrency} (target speed: ${this.maxSpeeds[queueName]})`);

        queue.process('sendMessage', concurrency, processJob);
        queue.process(concurrency, processJob); // Handle default jobs without names

        console.log(`[MailingQueueWorker] Queue processor set up successfully for ${queueName}`);

        // Добавляем обработчики событий для мониторинга
        queue.on('active', (job) => {
            console.log(`[MailingQueueWorker] Job ${job.id} started processing in queue ${queueName}`);
        });

        queue.on('completed', (job, result) => {
            console.log(`[MailingQueueWorker] Job ${job.id} completed in queue ${queueName}`);
        });

        queue.on('failed', (job, err) => {
            console.log(`[MailingQueueWorker] Job ${job.id} failed in queue ${queueName}:`, err.message);
        });

        queue.on('stalled', (job) => {
            console.log(`[MailingQueueWorker] Job ${job.id} stalled in queue ${queueName}`);
        });

        return queue;
    }

    private async checkAndCompleteQueue(queueName: string, reservationId?: number) {
        // Если очередь уже завершена, не делаем ничего
        if (this.queueCompleted[queueName]) {
            return;
        }
        
        // Проверяем завершение: jobsProcessed >= исходное количество jobs
        // (не учитываем retry jobs в общем подсчете)
        const originalJobsCount = this.jobsAdded[queueName];
        const processedCount = this.jobsProcessed[queueName];
        
        console.log(`[${queueName}] Queue progress: ${processedCount}/${originalJobsCount} processed, ${this.retryJobs[queueName]} retries`);
        
        if (processedCount >= originalJobsCount && originalJobsCount > 0) {
            // Помечаем очередь как завершенную ПЕРЕД очисткой
            this.queueCompleted[queueName] = true;
            
            console.log(`[MailingQueueWorker] Queue ${queueName} completed. Successfully sent: ${this.sentCounters[queueName]}, Failed: ${this.failCounters[queueName]}, Retries: ${this.retryJobs[queueName]}`);
            if (reservationId) {
                try {
                    const sentRemainder = this.sentCounters[queueName] % this.updateIntervals[queueName];
                    if (sentRemainder > 0) {
                        await this.mailingReservationsService.incrementQueueSent(queueName, sentRemainder);
                    }

                    const failRemainder = this.failCounters[queueName] % this.updateIntervals[queueName];
                    if (failRemainder > 0) {
                        await this.mailingReservationsService.incrementQueueFailed(queueName, failRemainder);
                    }

                    await this.mailingReservationsService.completeQueue(queueName);
                    
                    // Закрываем очередь перед удалением из кэша
                    if (this.queues[queueName]) {
                        await this.queues[queueName].close();
                    }
                    
                    // Удаляем очередь из кэша после завершения
                    delete this.queues[queueName];
                    delete this.sentCounters[queueName];
                    delete this.failCounters[queueName];
                    delete this.updateIntervals[queueName];
                    delete this.totalUsers[queueName];
                    delete this.sourceMessages[queueName];
                    delete this.useCopyMode[queueName];
                    delete this.jobsAdded[queueName];
                    delete this.jobsProcessed[queueName];
                    delete this.startTime[queueName];
                    delete this.retryJobs[queueName];
                    delete this.queueCompleted[queueName];
                    delete this.activeJobs[queueName];
                    delete this.currentSpeeds[queueName];
                    delete this.lastSpeedLimit[queueName];
                    delete this.maxSpeeds[queueName];
                    delete this.floodWaitHistory[queueName];
                    delete this.processedPerSecond[queueName];
                    delete this.lastSecondTimestamp[queueName];
                } catch (err) {
                    console.error(`[MailingQueueWorker] Failed to finalize reservation queue:`, err);
                }
            }
        }
    }

    async addJobsToQueue(queueName: string, jobCount: number) {
        this.jobsAdded[queueName] = jobCount;
        this.retryJobs[queueName] = 0; // Сбрасываем счётчик retry при новой загрузке
        this.queueCompleted[queueName] = false; // Сбрасываем флаг завершения
        console.log(`[MailingQueueWorker] Added ${jobCount} jobs to queue ${queueName}`);
        
        // Проверим состояние очереди с обработкой ошибок
        if (this.queues[queueName]) {
            const queue = this.queues[queueName];
            try {
                const waiting = await queue.getWaiting();
                const active = await queue.getActive();
                const completed = await queue.getCompleted();
                const failed = await queue.getFailed();
                
                console.log(`[MailingQueueWorker] Queue ${queueName} status: waiting: ${waiting.length}, active: ${active.length}, completed: ${completed.length}, failed: ${failed.length}`);
                
                // Предупреждение для больших очередей
                if (waiting.length > 5000) {
                    console.warn(`[MailingQueueWorker] Large queue detected: ${waiting.length} jobs waiting. Performance may be affected.`);
                }
            } catch (error) {
                console.error(`[MailingQueueWorker] Error checking queue status for ${queueName}:`, error);
                // Не прерываем выполнение, просто логируем ошибку
            }
        }
    }

    getSuccessfullySent(queueName: string): number {
        return this.sentCounters[queueName] || 0;
    }

    getCurrentSpeed(queueName: string): number {
        return this.currentSpeeds[queueName] || 0;
    }

    /**
     * Получить фактическую скорость обработки (сообщений в секунду)
     * @param queueName - Имя очереди
     * @returns Количество сообщений, обработанных в предыдущую секунду
     */
    getActualProcessingSpeed(queueName: string): number {
        const speedData = this.processedPerSecond[queueName];
        if (!speedData || speedData.length === 0) {
            return 0;
        }
        
        // Возвращаем количество сообщений, обработанных в последнюю секунду
        return speedData[speedData.length - 1] || 0;
    }

    /**
     * Получить среднюю фактическую скорость обработки за последние N секунд
     * @param queueName - Имя очереди
     * @param seconds - Количество секунд для усреднения (по умолчанию 10)
     * @returns Средняя скорость обработки
     */
    getAverageProcessingSpeed(queueName: string, seconds: number = 10): number {
        const speedData = this.processedPerSecond[queueName];
        if (!speedData || speedData.length === 0) {
            return 0;
        }
        
        const lastNSeconds = speedData.slice(-seconds);
        const total = lastNSeconds.reduce((sum, count) => sum + count, 0);
        return Math.round(total / lastNSeconds.length * 10) / 10; // Округляем до 1 знака после запятой
    }

    async gracefulShutdown(queueName?: string) {
        const queuesToClose = queueName ? [queueName] : Object.keys(this.queues);
        
        for (const name of queuesToClose) {
            if (this.queues[name]) {
                try {
                    console.log(`[MailingQueueWorker] Gracefully closing queue ${name}`);
                    await this.queues[name].close();
                    delete this.queues[name];
                    console.log(`[MailingQueueWorker] Queue ${name} closed successfully`);
                } catch (error) {
                    console.error(`[MailingQueueWorker] Error closing queue ${name}:`, error);
                }
            }
        }
    }
}
