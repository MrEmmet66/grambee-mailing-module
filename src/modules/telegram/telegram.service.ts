import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import * as fs from 'fs';
// import { dnsCache } from '../../dns-cache'; // ОТКЛЮЧЕНО для тестирования

@Injectable()
export class TelegramService {
  constructor(
    private readonly httpService: HttpService,
    private configService: ConfigService,
    @InjectBot() private readonly bot: Telegraf<Context>
  ) { }

  async approveChatJoinRequest(chatId: string, userId: number, botToken: string) {
    const url = `https://api.telegram.org/bot${botToken}/approveChatJoinRequest`;

    await this.httpService
      .post(url, { chat_id: chatId, user_id: userId })
  }

  async getChatInfo(chatId: string, botToken: string) {
    const url = `https://api.telegram.org/bot${botToken}/getChat`;
    const response = await firstValueFrom(
      this.httpService.post(url, { chat_id: chatId })
    );
    if (response.data.ok) {
      return response.data;
    } else {
      throw new HttpException(`Failed to get chat info: ${response.data.description}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

    async sendMessageViaBot(chatId: string | number, text: string, options?: any) {
    try {
      return await this.bot.telegram.sendMessage(chatId, text, options);
    } catch (err) {
      throw new Error(`sendMessageViaBot failed: ${err?.message || err}`);
    }
  }

  async copyMessage(botToken: string, fromChatId: string, messageId: number, toChatId: string, inlineKeyboard?: any, mailingId?: string) {
    console.log(`[TelegramService] Copying message from ${fromChatId} to ${toChatId} with message ID ${messageId}`);
    
    // Используем кэшированный DNS для избежания EAI_AGAIN ошибок
    const url = await this.getCachedApiUrl(botToken, '/copyMessage');
    
    // Получаем слот для запроса с уникальным ключом для рассылки
    const releaseSlot = await this.acquireRequestSlot(botToken, mailingId);
    
    try {
      // Оборачиваем в улучшенную retry логику с адаптацией семафоров
      return await this.executeWithRetry(async () => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };
        
        // ИСПОЛЬЗУЕМ HttpService с connection pooling вместо fetch
        const agents = this.getHttpAgent();
        const response = await firstValueFrom(
          this.httpService.post(url, {
            chat_id: toChatId,
            from_chat_id: fromChatId,
            message_id: messageId,
            reply_markup: inlineKeyboard
          }, {
            timeout: 15000,
            httpAgent: agents.http,
            httpsAgent: agents.https,
            headers: headers
          })
        );

        if (!response.data.ok) {
          throw new Error(`Failed to copy message: ${JSON.stringify(response.data)}`);
        }
        
        return response.data;
      }, 6, 300, `copyMessage to ${toChatId}`, botToken, mailingId); // Передаем botToken и mailingId для адаптации семафоров
      
    } finally {
      // Освобождаем слот
      releaseSlot();
    }
  }

  async notifyUser(chatId: string, message: string) {
    const botToken = this.configService.get<string>('MAIN_BOT')
    const gatewayUrl = this.configService.get<string>('GATEWAY_URL');

    if (!botToken || !gatewayUrl) {
      throw new HttpException('Bot token or gateway URL is not configured', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    // notify user in telegram
    const response = await firstValueFrom(
      this.httpService.post(url, {
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      })
    );

    if (!response.data.ok) {
      throw new HttpException(`Failed to send message: ${response.data.description}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    // Notify user in gateway
    const gatewayResponse = await firstValueFrom(
      this.httpService.post(`${gatewayUrl}/api/v1/notifications`, {
        telegramId: chatId,
        message,
      })
    );

    if (!gatewayResponse.data.ok) {
      throw new HttpException(`Failed to notify user in gateway: ${gatewayResponse.data.description}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }


  async createChatInviteLink(chatId: string, botToken: string) {
    const url = `https://api.telegram.org/bot${botToken}/createChatInviteLink`;
    const response = await firstValueFrom(
      this.httpService.post(url, { chat_id: chatId, creates_join_request: true })
    );

    if (response.data.ok) {
      return response.data.result.invite_link;
    } else {
      throw new HttpException(`Failed to create chat invite link: ${response.data.description}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async generateTrackingLink(isChannel: boolean, channelId, mailingId: number, sellerId: number, botSellerLink?: string, botToken?: string) {
      let trackingLink = '';
      if (isChannel) {
        // Generate invite link for channel
        try {
          const response = await fetch(
            `https://api.telegram.org/bot${botToken}/createChatInviteLink`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                chat_id: channelId,
                name: `Mailing_${mailingId}`,
                creates_join_request: true
              })
            }
          );

          const data = await response.json();
          if (data.ok && data.result && data.result.invite_link) {
            trackingLink = data.result.invite_link;
          } else {
            // Fallback to original link if API fails
            trackingLink = botSellerLink || '';
          }
        } catch (error) {
          console.error('Failed to create channel invite link:', error);
          trackingLink = botSellerLink || '';
        }
      } else {
        // Generate start parameter for bot
        const uniqueId = `m${mailingId}_s${sellerId}_${Date.now().toString(36)}`;
        const botUsername = botSellerLink?.split('/').pop() || '';
        trackingLink = `https://t.me/${botUsername}?start=${uniqueId}`;
      }
      return trackingLink;
  }

  async setupWebhook(botToken: string) {
    const webhookUrl = this.configService.get<string>('TELEGRAM_WEBHOOK_URL');
    if (!webhookUrl) {
      throw new HttpException('TELEGRAM_WEBHOOK_URL is not set in config', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const url = `https://api.telegram.org/bot${botToken}/setWebhook`;
    const response = await firstValueFrom(
      this.httpService.post(url, { url: `${webhookUrl}/api/v1/telegram/webhook` })
    );

    if (response.data.ok) {
      console.log(`Webhook set successfully: ${response.data} for bot ${botToken}`);
    } else {
      throw new HttpException(`Failed to set webhook: ${response.data.description}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Надежный connection pooling с DNS устойчивостью для сотен рассылок
  private static httpAgent: any = null;
  private static httpsAgent: any = null;
  
  private getHttpAgent() {
    if (!TelegramService.httpAgent) {
      const http = require('http');
      const https = require('https');
      const dns = require('dns');
      
      // Настраиваем надежные DNS серверы для стабильности при высокой нагрузке
      dns.setServers([
        '8.8.8.8',      // Google DNS
        '1.1.1.1',      // Cloudflare DNS  
        '8.8.4.4',      // Google DNS вторичный
        '1.0.0.1'       // Cloudflare DNS вторичный
      ]);
      
      // Кастомный lookup с retry для устойчивости к DNS ошибкам
      const resilientLookup = (hostname: string, options: any, callback: Function) => {
        let attempts = 0;
        const maxAttempts = 3;
        
        const tryLookup = () => {
          attempts++;
          dns.lookup(hostname, options, (err: any, address: string, family: number) => {
            if (err && attempts < maxAttempts && (err.code === 'EAI_AGAIN' || err.code === 'ENOTFOUND')) {
              const delay = attempts * 200; // Progressive delay: 200ms, 400ms, 600ms
              console.log(`[TelegramService] DNS lookup attempt ${attempts} failed for ${hostname}, retrying in ${delay}ms... (${err.code})`);
              setTimeout(tryLookup, delay);
              return;
            }
            callback(err, address, family);
          });
        };
        
        tryLookup();
      };
      
      // Создаем агенты с увеличенным pooling для сотен рассылок
      TelegramService.httpAgent = new http.Agent({
        keepAlive: true,
        maxSockets: 200,        // Увеличено для сотен рассылок
        maxFreeSockets: 50,     // Больше свободных сокетов
        timeout: 20000,         // Увеличен таймаут для DNS stability
        freeSocketTimeout: 45000,
        lookup: resilientLookup,
      });
      
      TelegramService.httpsAgent = new https.Agent({
        keepAlive: true,
        maxSockets: 200,        // Увеличено для сотен рассылок
        maxFreeSockets: 50,     // Больше свободных сокетов  
        timeout: 20000,         // Увеличен таймаут для DNS stability
        freeSocketTimeout: 45000,
        lookup: resilientLookup, // Используем устойчивый DNS lookup
      });
      
      console.log('[TelegramService] HTTP/HTTPS agents created with DNS resilience and expanded connection pooling (max 200 sockets each, resilient DNS for hundreds of mailings)');
    }
    return { http: TelegramService.httpAgent, https: TelegramService.httpsAgent };
  }

  // Получение URL без DNS кэширования (для тестирования независимых семафоров)
  private async getCachedApiUrl(botToken: string, endpoint: string = ''): Promise<string> {
    // DNS КЭШИРОВАНИЕ ПОЛНОСТЬЮ ОТКЛЮЧЕНО для диагностики независимых рассылок
    const directUrl = `https://api.telegram.org/bot${botToken}${endpoint}`;
    console.log(`[TelegramService] Using DIRECT URL (DNS cache DISABLED): ${directUrl.substring(0, 50)}...`);
    return directUrl;
  }

  // Интеллектуальная retry логика с адаптацией семафоров при DNS ошибках
  private async executeWithRetry<T>(
    operation: () => Promise<T>, 
    maxRetries: number = 6,  // Увеличено для DNS ошибок при сотнях рассылок
    baseDelay: number = 300, // Уменьшено для быстрого recovery
    context: string = 'API call',
    botToken?: string,
    mailingId?: string
  ): Promise<T> {
    let lastError: any;
    let consecutiveDnsErrors = 0;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        
        // При успехе - восстанавливаем семафоры
        if (consecutiveDnsErrors > 0 && botToken) {
          this.recoverSemaphoreOnSuccess(botToken, mailingId);
        }
        
        return result;
      } catch (error) {
        lastError = error;
        
        // Определяем тип ошибки
        const isDnsError = error?.code === 'EAI_AGAIN' || error?.code === 'ENOTFOUND';
        const shouldRetry = this.shouldRetryError(error);
        
        if (isDnsError) {
          consecutiveDnsErrors++;
          // Адаптируем семафоры при DNS ошибках
          if (botToken) {
            this.adaptSemaphoreOnDnsError(botToken, mailingId);
          }
        }
        
        if (!shouldRetry || attempt === maxRetries) {
          console.log(`[TelegramService] ${context} FINAL FAILURE after ${attempt} attempts:`, {
            errorCode: error?.code,
            errorMessage: error?.message?.substring(0, 150),
            shouldRetry: shouldRetry,
            isDnsError: isDnsError,
            consecutiveDnsErrors: consecutiveDnsErrors,
            mailingId: mailingId || 'none'
          });
          break;
        }

        // Специальная логика задержек для разных типов ошибок
        let delay;
        if (isDnsError) {
          // Для DNS ошибок - быстрые retry с небольшим увеличением
          delay = baseDelay + (consecutiveDnsErrors * 200); // 300ms, 500ms, 700ms...
        } else {
          // Для других ошибок - экспоненциальная задержка
          delay = baseDelay * Math.pow(1.8, attempt - 1);
        }
        delay = Math.min(delay, 8000); // Максимум 8 секунд
        
        console.log(`[TelegramService] ${context} attempt ${attempt} failed, retrying in ${delay}ms:`, {
          errorCode: error?.code,
          errorMessage: error?.message?.substring(0, 100),
          nextAttempt: attempt + 1,
          isDnsError: isDnsError,
          consecutiveDnsErrors: consecutiveDnsErrors,
          adaptedConcurrency: botToken ? TelegramService.requestSemaphores[mailingId ? `${botToken}_mailing_${mailingId}` : botToken]?.maxRequests : 'unknown'
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }
  
  private shouldRetryError(error: any): boolean {
    // Retry для DNS и сетевых ошибок
    const retryableCodes = [
      'EAI_AGAIN',      // DNS временно недоступен
      'ECONNRESET',     // Соединение сброшено
      'ECONNREFUSED',   // Соединение отклонено
      'ETIMEDOUT',      // Таймаут соединения
      'ENOTFOUND',      // DNS не найден (временно)
      'UND_ERR_CONNECT_TIMEOUT', // undici таймаут
      'ECONNABORTED',   // Соединение прервано
    ];
    
    // Retry для HTTP статусов
    const retryableStatuses = [502, 503, 504, 429]; // Bad Gateway, Service Unavailable, Gateway Timeout, Too Many Requests
    
    return retryableCodes.includes(error?.code) || 
           retryableStatuses.includes(error?.response?.status) ||
           (error?.message && error.message.includes('socket hang up'));
  }

  // Адаптивные семафоры с автоматическим снижением concurrency при DNS ошибках
  private static requestSemaphores: Record<string, any> = {};
  private static dnsErrorCounts: Record<string, number> = {}; // Счетчики DNS ошибок для адаптации
  
  private async acquireRequestSlot(botToken: string, mailingId?: string): Promise<() => void> {
    // Уникальный ключ для каждой рассылки (независимые семафоры)
    const semaphoreKey = mailingId ? `${botToken}_mailing_${mailingId}` : botToken;
    
    if (!TelegramService.requestSemaphores[semaphoreKey]) {
      // УВЕЛИЧЕННЫЙ concurrency для максимальной производительности параллельных рассылок
      const baseConcurrency = mailingId ? 50 : 30; // ЗНАЧИТЕЛЬНО УВЕЛИЧЕНО для устранения bottleneck
      TelegramService.requestSemaphores[semaphoreKey] = {
        activeRequests: 0,
        maxRequests: baseConcurrency,
        waitingQueue: [],
        baseConcurrency: baseConcurrency, // Запоминаем базовое значение
        lastDnsError: 0, // Время последней DNS ошибки
        dnsErrorStreak: 0 // Подряд идущие DNS ошибки
      };
      TelegramService.dnsErrorCounts[semaphoreKey] = 0;
      console.log(`[TelegramService] Created ADAPTIVE semaphore for ${mailingId ? `mailing ${mailingId}` : `bot ${botToken.substring(0, 10)}...`} with ${baseConcurrency} base concurrent requests (MAXIMUM PARALLEL THROUGHPUT for hundreds of mailings)`);
    }
    
    const semaphore = TelegramService.requestSemaphores[semaphoreKey];
    
    // Если есть свободные слоты, занимаем сразу
    if (semaphore.activeRequests < semaphore.maxRequests) {
      semaphore.activeRequests++;
      return () => {
        semaphore.activeRequests--;
        // Запускаем следующий запрос из очереди
        if (semaphore.waitingQueue.length > 0) {
          const nextResolve = semaphore.waitingQueue.shift();
          semaphore.activeRequests++;
          nextResolve(() => {
            semaphore.activeRequests--;
            if (semaphore.waitingQueue.length > 0) {
              const resolve = semaphore.waitingQueue.shift();
              semaphore.activeRequests++;
              resolve(() => {
                semaphore.activeRequests--;
              });
            }
          });
        }
      };
    }
    
    // Если нет свободных слотов, ждем в очереди
    return new Promise<() => void>((resolve) => {
      semaphore.waitingQueue.push(resolve);
    });
  }

  // Метод для адаптивного снижения concurrency при DNS ошибках
  private adaptSemaphoreOnDnsError(botToken: string, mailingId?: string): void {
    const semaphoreKey = mailingId ? `${botToken}_mailing_${mailingId}` : botToken;
    const semaphore = TelegramService.requestSemaphores[semaphoreKey];
    
    if (!semaphore) return;
    
    const now = Date.now();
    semaphore.lastDnsError = now;
    semaphore.dnsErrorStreak++;
    
    // Агрессивно снижаем concurrency при повторных DNS ошибках
    if (semaphore.dnsErrorStreak >= 3 && semaphore.maxRequests > 3) {
      const oldMax = semaphore.maxRequests;
      semaphore.maxRequests = Math.max(3, Math.floor(semaphore.maxRequests * 0.6)); // Снижаем на 40%
      console.log(`[TelegramService] DNS ERROR ADAPTATION: ${mailingId ? `mailing ${mailingId}` : 'bot'} concurrency reduced ${oldMax} -> ${semaphore.maxRequests} (streak: ${semaphore.dnsErrorStreak})`);
    }
  }

  // Метод для восстановления concurrency при стабильной работе
  private recoverSemaphoreOnSuccess(botToken: string, mailingId?: string): void {
    const semaphoreKey = mailingId ? `${botToken}_mailing_${mailingId}` : botToken;
    const semaphore = TelegramService.requestSemaphores[semaphoreKey];
    
    if (!semaphore) return;
    
    const now = Date.now();
    const timeSinceLastDnsError = now - (semaphore.lastDnsError || 0);
    
    // Если прошло 30 секунд без DNS ошибок, медленно восстанавливаем concurrency
    if (timeSinceLastDnsError > 30000 && semaphore.maxRequests < semaphore.baseConcurrency) {
      semaphore.dnsErrorStreak = Math.max(0, semaphore.dnsErrorStreak - 1);
      
      if (semaphore.dnsErrorStreak === 0) {
        const oldMax = semaphore.maxRequests;
        semaphore.maxRequests = Math.min(semaphore.baseConcurrency, semaphore.maxRequests + 2); // Медленно увеличиваем
        if (oldMax !== semaphore.maxRequests) {
          console.log(`[TelegramService] DNS RECOVERY: ${mailingId ? `mailing ${mailingId}` : 'bot'} concurrency recovered ${oldMax} -> ${semaphore.maxRequests}`);
        }
      }
    }
  }

  async sendTextMessage(botToken: string, chatId: string | number, text: string, inlineKeyboard?: any, mailingId?: string): Promise<number> {
    // Используем кэшированный DNS для избежания EAI_AGAIN ошибок
    const url = await this.getCachedApiUrl(botToken, '/sendMessage');
    
    // Получаем слот для запроса с уникальным ключом для рассылки
    const releaseSlot = await this.acquireRequestSlot(botToken, mailingId);
    
    try {
      // Оборачиваем в улучшенную retry логику с адаптацией семафоров
      return await this.executeWithRetry(async () => {        
        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };
        
        // ИСПОЛЬЗУЕМ HttpService с connection pooling вместо fetch
        const agents = this.getHttpAgent();
        const response = await firstValueFrom(
          this.httpService.post(url, {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            reply_markup: inlineKeyboard
          }, {
            timeout: 15000,
            httpAgent: agents.http,
            httpsAgent: agents.https,
            headers: headers
          })
        );
      
        if (!response.data.ok) {
          throw new Error(`Failed to send message: ${JSON.stringify(response.data)}`);
        }
      
        const data = response.data;
        if (data && data.result && data.result.message_id) {
          return data.result.message_id;
        } else {
          throw new Error(`Invalid API response: ${JSON.stringify(data)}`);
        }
      }, 6, 300, `sendTextMessage to ${chatId}`, botToken, mailingId); // Передаем botToken и mailingId для адаптации семафоров
      
    } finally {
      // Освобождаем слот
      releaseSlot();
    }
  }

  async sendMediaMessage(botToken: string, chatId: string | number, mailing: any, inlineKeyboard?: any, mailingId?: string): Promise<number> {
    if (!botToken || !botToken.includes(':')) {
      throw new Error(`Invalid bot token format`);
    }
    let mediaType = mailing.postMediaType || 'photo';
    let endpoint;
    switch (mediaType.toLowerCase()) {
      case 'photo': endpoint = 'sendPhoto'; break;
      case 'video': endpoint = 'sendVideo'; break;
      case 'document': endpoint = 'sendDocument'; break;
      case 'audio': endpoint = 'sendAudio'; break;
      default: endpoint = 'sendPhoto';
    }
    // Используем кэшированный DNS для избежания EAI_AGAIN ошибок
    const url = await this.getCachedApiUrl(botToken, `/${endpoint}`);
    const mediaUrl = process.cwd() + mailing.postMedia;
    if (!fs.existsSync(mediaUrl)) {
      throw new Error(`Media file not found: ${mediaUrl}`);
    }
    const stats = fs.statSync(mediaUrl);
    if (stats.size === 0) {
      throw new Error(`Media file is empty: ${mediaUrl}`);
    }
    const maxSizes = {
      photo: 10 * 1024 * 1024,
      video: 50 * 1024 * 1024,
      document: 50 * 1024 * 1024,
      audio: 50 * 1024 * 1024
    };
    if (stats.size > (maxSizes[mediaType.toLowerCase()] || maxSizes.photo)) {
      throw new Error(`File too large for ${mediaType}: ${stats.size} bytes`);
    }
    
    // Получаем слот для запроса с уникальным ключом для рассылки
    const releaseSlot = await this.acquireRequestSlot(botToken, mailingId);
    
    try {
      // Оборачиваем в улучшенную retry логику с адаптацией семафоров
      return await this.executeWithRetry(async () => {
        const FormData = require('form-data');
        const formData = new FormData();
        formData.append('chat_id', chatId);
        if (mailing.postContent && mailing.postContent.trim()) {
          formData.append('caption', mailing.postContent);
          formData.append('parse_mode', 'HTML');
        }
        if (inlineKeyboard) {
          formData.append('reply_markup', JSON.stringify(inlineKeyboard));
        }
        const mediaField = mediaType.toLowerCase() === 'photo' ? 'photo' :
          mediaType.toLowerCase() === 'video' ? 'video' :
          mediaType.toLowerCase() === 'audio' ? 'audio' : 'document';
        formData.append(mediaField, fs.createReadStream(mediaUrl));
        
        const headers = { ...formData.getHeaders() };
        
        const response = await this.httpService.axiosRef({
          method: 'POST',
          url: url,
          data: formData,
          headers: headers,
          timeout: 60000,
          validateStatus: function (status) { return status < 500; }
        });
        
        if (response.status >= 400) {
          throw new Error(`Failed to send media message: ${JSON.stringify(response.data)}`);
        }
        
        const data = response.data;
        if (data && data.result && data.result.message_id) {
          return data.result.message_id;
        } else {
          throw new Error(`No message_id in sendMediaMessage response: ${JSON.stringify(data)}`);
        }
      }, 6, 400, `sendMediaMessage to ${chatId}`, botToken, mailingId); // Передаем botToken и mailingId для адаптации семафоров
      
    } finally {
      // Освобождаем слот
      releaseSlot();
    }
  }

  buildInlineKeyboard(buttons: any) {
    if (buttons && typeof buttons === 'object' && buttons.inline_keyboard) {
      return buttons;
    }
    return undefined;
  }

  createButtonWithInviteLink(buttonText: string, inviteLink: string) {
    if (!buttonText || !inviteLink) {
      return undefined;
    }
    return {
      inline_keyboard: [
        [
          {
            text: buttonText,
            url: inviteLink
          }
        ]
      ]
    };
  }
}