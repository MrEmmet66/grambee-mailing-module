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

  async sendTextMessage(botToken: string, chatId: string | number, text: string, inlineKeyboard?: any) {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard
      }),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to send message: ${JSON.stringify(errorData)}`);
    }
    return await response.json();
  }

  async sendMediaMessage(botToken: string, chatId: string | number, mailing: any, inlineKeyboard?: any) {
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
        throw new Error(`Failed to send media message: ${JSON.stringify(response.data)}`);
      }
      return response.data;
    } catch (error) {
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