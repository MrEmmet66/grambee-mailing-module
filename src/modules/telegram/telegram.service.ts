import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import * as fs from 'fs';

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

  async copyMessage(botToken: string, fromChatId: string, messageId: number, toChatId: string, inlineKeyboard?: any) {
    console.log(`[TelegramService] Copying message from ${fromChatId} to ${toChatId} with message ID ${messageId}`);
    
    const url = `https://api.telegram.org/bot${botToken}/copyMessage`;
    
    // Получаем слот для запроса
    const releaseSlot = await this.acquireRequestSlot(botToken);
    
    try {
      // Используем fetch как в sendTextMessage для единообразия и скорости
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: toChatId,
          from_chat_id: fromChatId,
          message_id: messageId,
          reply_markup: inlineKeyboard
        }),
        // Используем тот же таймаут
        signal: AbortSignal.timeout(15000), // 15 секунд таймаут
      });

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (jsonErr) {
          errorData = { error: 'Failed to parse error response', status: response.status };
        }
        
        // Логируем детали ошибки для диагностики flood-wait
        console.log(`[TelegramService] copyMessage error for user ${toChatId}:`, {
          status: response.status,
          statusText: response.statusText,
          errorData: errorData,
          headers: Object.fromEntries(response.headers.entries()),
          fromChatId: fromChatId,
          messageId: messageId,
          url: url
        });
        
        throw new Error(`Failed to copy message: ${JSON.stringify(errorData)}`);
      }
      const data = await response.json();
      console.log(`[TelegramService] copyMessage success for user ${toChatId}:`, {
        messageId: data?.result?.message_id,
        fullResponse: data
      });
      return data;
    } catch (err) {
      // Улучшенная диагностика сетевых ошибок
      if (err.name === 'AbortError') {
        throw new Error(`copyMessage timeout (15s) for user ${toChatId}: ${err?.message || err}`);
      } else if (err.code === 'UND_ERR_CONNECT_TIMEOUT') {
        throw new Error(`copyMessage connection timeout for user ${toChatId}: ${err?.message || err}`);
      } else if (err.code === 'ECONNRESET') {
        throw new Error(`copyMessage connection reset for user ${toChatId}: ${err?.message || err}`);
      } else if (err.code === 'ENOTFOUND') {
        throw new Error(`copyMessage DNS resolution failed for user ${toChatId}: ${err?.message || err}`);
      } else if (err.code === 'ECONNREFUSED') {
        throw new Error(`copyMessage connection refused for user ${toChatId}: ${err?.message || err}`);
      } else if (err.code === 'ETIMEDOUT') {
        throw new Error(`copyMessage connection timeout for user ${toChatId}: ${err?.message || err}`);
      } else if (err.message && err.message.includes('Failed to copy message:')) {
        // Это уже обработанная ошибка от API, пробрасываем как есть
        throw err;
      } else {
        // Логируем полную информацию о неизвестной ошибке
        console.error(`[TelegramService] copyMessage unknown error for user ${toChatId}:`, {
          errorName: err?.name,
          errorCode: err?.code,
          errorMessage: err?.message,
          errorStack: err?.stack,
          errorCause: err?.cause,
          fullError: err,
          fromChatId: fromChatId,
          messageId: messageId,
          url: url
        });
        throw new Error(`copyMessage fetch failed for user ${toChatId}: ${err?.message || err}`);
      }
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

  // Semaphore для ограничения количества одновременных запросов
  private static requestSemaphores: Record<string, any> = {};
  
  private async acquireRequestSlot(botToken: string): Promise<() => void> {
    if (!TelegramService.requestSemaphores[botToken]) {
      // Создаем семафор с лимитом 8 одновременных запросов на бота
      const maxConcurrentRequests = 8;
      TelegramService.requestSemaphores[botToken] = {
        activeRequests: 0,
        maxRequests: maxConcurrentRequests,
        waitingQueue: []
      };
      console.log(`[TelegramService] Created request semaphore for bot ${botToken.substring(0, 10)}... with ${maxConcurrentRequests} max concurrent requests`);
    }
    
    const semaphore = TelegramService.requestSemaphores[botToken];
    
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

  async sendTextMessage(botToken: string, chatId: string | number, text: string, inlineKeyboard?: any): Promise<number> {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    // Получаем слот для запроса
    const releaseSlot = await this.acquireRequestSlot(botToken);
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'Markdown',
          reply_markup: inlineKeyboard
        }),
        // Уменьшаем таймаут для более быстрого обнаружения проблем
        signal: AbortSignal.timeout(15000), // 15 секунд таймаут
      });
      
      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (jsonErr) {
          errorData = { error: 'Failed to parse error response', status: response.status };
        }
        
        // Логируем детали ошибки для диагностики flood-wait
        console.log(`[TelegramService] sendTextMessage error for user ${chatId}:`, {
          status: response.status,
          statusText: response.statusText,
          errorData: errorData,
          headers: Object.fromEntries(response.headers.entries()),
          url: url
        });
        
        throw new Error(`Failed to send message: ${JSON.stringify(errorData)}`);
      }
      
      const data = await response.json();
      if (data && data.result && data.result.message_id) {
        return data.result.message_id;
      } else {
        throw new Error(`No message_id in sendTextMessage response: ${JSON.stringify(data)}`);
      }
    } catch (err) {
      // Улучшенная диагностика сетевых ошибок
      if (err.name === 'AbortError') {
        throw new Error(`sendTextMessage timeout (15s) for user ${chatId}: ${err?.message || err}`);
      } else if (err.code === 'UND_ERR_CONNECT_TIMEOUT') {
        throw new Error(`sendTextMessage connection pool timeout for user ${chatId}: ${err?.message || err}`);
      } else if (err.code === 'ECONNRESET') {
        throw new Error(`sendTextMessage connection reset for user ${chatId}: ${err?.message || err}`);
      } else if (err.code === 'ENOTFOUND') {
        throw new Error(`sendTextMessage DNS resolution failed for user ${chatId}: ${err?.message || err}`);
      } else if (err.code === 'ECONNREFUSED') {
        throw new Error(`sendTextMessage connection refused for user ${chatId}: ${err?.message || err}`);
      } else if (err.code === 'ETIMEDOUT') {
        throw new Error(`sendTextMessage connection timeout for user ${chatId}: ${err?.message || err}`);
      } else if (err.message && err.message.includes('Failed to send message:')) {
        // Это уже обработанная ошибка от API, пробрасываем как есть
        throw err;
      } else {
        // Логируем полную информацию о неизвестной ошибке
        console.error(`[TelegramService] sendTextMessage unknown error for user ${chatId}:`, {
          errorName: err?.name,
          errorCode: err?.code,
          errorMessage: err?.message,
          errorStack: err?.stack,
          errorCause: err?.cause,
          fullError: err,
          url: url
        });
        throw new Error(`sendTextMessage fetch failed for user ${chatId}: ${err?.message || err}`);
      }
    } finally {
      // Освобождаем слот
      releaseSlot();
    }
  }

  async sendMediaMessage(botToken: string, chatId: string | number, mailing: any, inlineKeyboard?: any): Promise<number> {
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
    const url = `https://api.telegram.org/bot${botToken}/${endpoint}`;
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
    try {
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
      const response = await this.httpService.axiosRef({
        method: 'POST',
        url: url,
        data: formData,
        headers: { ...formData.getHeaders() },
        timeout: 60000,
        validateStatus: function (status) { return status < 500; }
      });
      if (response.status >= 400) {
        // Логируем детали ошибки для диагностики flood-wait
        console.log(`[TelegramService] sendMediaMessage error for user ${chatId}:`, {
          status: response.status,
          statusText: response.statusText,
          responseData: response.data,
          headers: response.headers,
          mediaType: mediaType
        });
        
        throw new Error(`Failed to send media message: ${JSON.stringify(response.data)}`);
      }
      const data = response.data;
      if (data && data.result && data.result.message_id) {
        return data.result.message_id;
      } else {
        throw new Error(`No message_id in sendMediaMessage response: ${JSON.stringify(data)}`);
      }
    } catch (error) {
      // Логируем детали ошибки для диагностики
      console.log(`[TelegramService] sendMediaMessage catch block for user ${chatId}:`, {
        errorMessage: error?.message,
        errorResponse: error?.response?.data,
        errorStatus: error?.response?.status,
        mediaType: mediaType,
        hasResponseData: !!error?.response?.data,
        fullError: error
      });
      
      if (error.response && error.response.data && error.response.data.description) {
        throw new Error(`Telegram API error: ${error.response.data.description}`);
      }
      if (mediaType.toLowerCase() !== 'document') {
        try {
          const documentMailing = { ...mailing, postMediaType: 'document' };
          return await this.sendMediaMessage(botToken, chatId, documentMailing, inlineKeyboard);
        } catch (fallbackError) {}
      }
      throw error;
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