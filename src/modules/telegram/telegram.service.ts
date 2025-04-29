import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { Mailing } from '@prisma/client';
import { text } from 'stream/consumers';

@Injectable()
export class TelegramService {
  constructor(private readonly httpService: HttpService, private configService: ConfigService, @InjectBot() private readonly bot: Telegraf<Context>) {}

  async sendMailingApplication(mailing: Mailing) {
    const chatId = this.configService.get<string>('ADMIN_CHAT_ID') || "2677251791";
    const applicationsTopicId = this.configService.get<number>('MAILING_APPLICATIONS_TOPIC_ID') || 12;

    const keyboardReplyMarkup = {
      inline_keyboard: [
        [
          {
            text: 'Подтвердить',
            callback_data: `confirm_mailing_application:${mailing.id}`,
          },
          {
            text: 'Отклонить',
            callback_data: `reject_mailing_application:${mailing.id}`,
          },
        ],
        [
          {
            text: 'В ожидание',
            callback_data: `wait_mailing_application:${mailing.id}`,
          }
        ]
      ]
    };

    const message = `Заявка на рассылку от ${mailing.userId}:\n\n` +
      `Контент: ${mailing.postContent}\n` +
      `Медиа: ${mailing.postMedia}\n` +
      `Тип медиа: ${mailing.postMediaType}\n` +
      `Кнопки: ${mailing.postButtons}`;

    try {
      await this.bot.telegram.sendMessage(chatId, message, {
        reply_markup: keyboardReplyMarkup,
        parse_mode: 'HTML',
        message_thread_id: applicationsTopicId,
      });
    } catch (error) {
      console.error('Error sending message to Telegram:', error);
      throw new HttpException('Failed to send message', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async setupCallbackHandlers() {
    this.bot.action(/confirm_mailing_application:(.+)/, (ctx) => this.handleConfirmMailing(ctx));
    this.bot.action(/reject_mailing_application:(.+)/, (ctx) => this.handleRejectMailing(ctx));
    this.bot.action(/wait_mailing_application:(.+)/, (ctx) => this.handleWaitMailing(ctx));
  }

  private async handleConfirmMailing(ctx: Context) {
    try {
      const mailingId = this.extractMailingId(ctx);
      await ctx.answerCbQuery(`Заявка ${mailingId} подтверждена`);
      await ctx.editMessageText(`Заявка подтверждена. ID: ${mailingId}`, { reply_markup: undefined });
      
      // Here you would add logic to update the mailing status in your database
      
      return true;
    } catch (error) {
      console.error('Error confirming mailing:', error);
      await ctx.answerCbQuery('Произошла ошибка при подтверждении заявки');
      return false;
    }
  }

  private async handleRejectMailing(ctx: Context) {
    try {
      const mailingId = this.extractMailingId(ctx);
      await ctx.answerCbQuery(`Заявка ${mailingId} отклонена`);
      await ctx.editMessageText(`Заявка отклонена. ID: ${mailingId}`, { reply_markup: undefined });
      
      // Here you would add logic to update the mailing status in your database
      
      return true;
    } catch (error) {
      console.error('Error rejecting mailing:', error);
      await ctx.answerCbQuery('Произошла ошибка при отклонении заявки');
      return false;
    }
  }

  private async handleWaitMailing(ctx: Context) {
    try {
      const mailingId = this.extractMailingId(ctx);
      await ctx.answerCbQuery(`Заявка ${mailingId} отправлена в ожидание`);
      await ctx.editMessageText(`Заявка в ожидании. ID: ${mailingId}`, { reply_markup: undefined });
      
      // Here you would add logic to update the mailing status in your database
      
      return true;
    } catch (error) {
      console.error('Error putting mailing on hold:', error);
      await ctx.answerCbQuery('Произошла ошибка при изменении статуса заявки');
      return false;
    }
  }

  private extractMailingId(ctx: Context): string {
    if (!ctx.callbackQuery) {
      throw new Error('Callback query is undefined');
    }
    
    if ('match' in ctx.callbackQuery && Array.isArray(ctx.callbackQuery.match)) {
      return ctx.callbackQuery.match[1];
    }
    throw new Error('Could not extract mailing ID from callback query');
  }
}