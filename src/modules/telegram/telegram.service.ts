import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';

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
}