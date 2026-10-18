import { Inject, forwardRef } from '@nestjs/common';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BotSellersService } from '../bot_sellers/bot-sellers.service';
import { BotSeller, Mailing } from '@prisma/client';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { MailingNotifyProps } from './telegram.types';
import { MailingService } from '../mailing/services/mailing.service';
import { resolveTelegramTargets } from './telegram-targets';

@Injectable()
export class ApplicationSendersService {
  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => BotSellersService))
    private readonly botSellersService: BotSellersService,
    @InjectBot() private readonly bot: Telegraf<Context>,
    @Inject(forwardRef(() => MailingService))
    private readonly mailingService: MailingService,
  ) {}

  getCategoryEmoji(category: string): string {
    let categoryEmoji = '';
    switch (category) {
      case 'GAMBLING':
        categoryEmoji = '🎰';
        break;
      case 'OTHER':
        categoryEmoji = '📦';
        break;
      case 'DATING':
        categoryEmoji = '💕';
        break;
      case 'GAMES':
        categoryEmoji = '🎮';
        break;
      case 'CRYPTO':
        categoryEmoji = '💰';
        break;
      case 'FUN':
        categoryEmoji = '🎭';
        break;
      case 'TECH':
        categoryEmoji = '🤖';
        break;
      case 'UTILITY':
        categoryEmoji = '🔧';
        break;
    }

    return categoryEmoji;
  }

  getCategoryName(category: string): string {
    const categories = {
      GAMBLING: 'Гэмблинг',
      OTHER: 'Другое',
      DATING: 'Знакомства',
      GAMES: 'Игры',
      CRYPTO: 'Крипто',
      FUN: 'Развлечения',
      TECH: 'Технологии/нейросети',
      UTILITY: 'Утилиты/Продуктивность',
    };
    return categories[category] || category;
  }

  async notifyAdminsAboutMailingExecution(props: MailingNotifyProps) {
    const { adminChatId: chatId, mailingNotifyTopicId: notifyTopicId } =
      resolveTelegramTargets(this.configService);

    // Escape HTML utility
    const escape = (text: any) =>
      String(text || '').replace(
        /[&<>]/g,
        (t) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[t] || t,
      );

    const message =
      `<b>🚀 Рассылка отправлена</b>\n\n` +
      `<b>Тип:</b> ${props.isChannel ? 'Канал' : 'Бот'}\n` +
      `<b>Стоимость:</b> ${props.paymentType === 'fixed' ? `Фиксированная (${escape(String(props.fixedPrice))}$)` : `Постоплата пдп (${escape(String(props.perSubscriberPrice))}$ за подписчика)`}\n` +
      `<b>Дата рекламы:</b> ${escape(props.mailingDate.toLocaleDateString())}\n` +
      `<b>Источник:</b> ${escape(props.botSellerLink)} @${escape(props.botSellerOwnerUsername || 'неизвестно')}\n` +
      `<b>Заказчик:</b> ${escape(props.mailingLink)} @${escape(props.mailingOwnerUsername || 'неизвестно')}`;

    const keyboard = {
      inline_keyboard: [
        [
          {
            text: '👀 Посмотреть пост',
            callback_data: `view_post:${props.reservationId}`,
          },
          {
            text: '✅ Одобрить',
            callback_data: `approve_mailing_process:${props.reservationId}`,
          },
        ],
        [
          {
            text: '❄️ Заморозить',
            callback_data: `freeze_mailing_process:${props.reservationId}`,
          },
          {
            text: '📊 Статистика',
            callback_data: `stats:${props.reservationId}`,
          },
        ],
      ],
    };

    await this.bot.telegram.sendMessage(chatId, message, {
      reply_markup: keyboard,
      parse_mode: 'HTML',
      message_thread_id: notifyTopicId,
    });
  }

  async sendMailingApplication(mailing: Mailing) {
    const {
      adminChatId: chatId,
      mailingApplicationsTopicId: applicationsTopicId,
    } = resolveTelegramTargets(this.configService);

    const mailingOwner = await this.mailingService.getMailingOwner(mailing.id);

    const keyboardReplyMarkup = {
      inline_keyboard: [
        [
          {
            text: '✅ Подтвердить',
            callback_data: `confirm_mailing_application:${mailing.id}`,
          },
          {
            text: '❌ Отклонить',
            callback_data: `reject_mailing_application:${mailing.id}`,
          },
        ],
        [
          {
            text: '⏳ В ожидание',
            callback_data: `wait_mailing_application:${mailing.id}`,
          },
        ],
      ],
    };

    // Display button text directly - no need for JSON parsing
    let buttonText = mailing.postButtons
      ? mailing.postButtons.toString()
      : 'Нет';

    // Status with emoji
    let statusEmoji = '';
    switch (mailing.status) {
      case 'PENDING':
        statusEmoji = '🔶';
        break;
      case 'APPROVED':
        statusEmoji = '✅';
        break;
      case 'REJECTED':
        statusEmoji = '❌';
        break;
      case 'WAITING':
        statusEmoji = '⏳';
        break;
    }

    // Determine if this is a channel or bot mailing
    const targetLink = mailing.link;

    const message =
      `<b>📨 НОВАЯ ЗАЯВКА НА РАССЫЛКУ</b>\n\n` +
      `<b>👤 Пользователь:</b> @${mailingOwner.username}\n` +
      `<b>🔗 Ссылка:</b> ${targetLink}\n` +
      `<b>📅 Дата создания:</b> ${new Date().toLocaleString('ru-RU')}\n` +
      `<b>📝 Контент:</b>\n<pre>${mailing.postContent}</pre>\n\n` +
      (mailing.postMedia
        ? `<b>🖼 Медиа:</b> ${mailing.postMedia}\n` +
          `<b>📂 Тип медиа:</b> ${mailing.postMediaType || 'Не указан'}\n\n`
        : '') +
      `<b>🔘 Кнопки:</b> ${buttonText}`;

    try {
      const sentMessage = await this.bot.telegram.sendMessage(chatId, message, {
        reply_markup: keyboardReplyMarkup,
        parse_mode: 'HTML',
        message_thread_id: applicationsTopicId,
      });
      console.log(
        `Mailing application message sent successfully, message id: ${sentMessage.message_id}`,
      );
      return sentMessage;
    } catch (error) {
      console.error('Error sending message to Telegram:', error);
      throw new HttpException(
        'Failed to send message',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async sendBotSellerApplication(botSeller: BotSeller) {
    const { adminChatId: chatId, botApplicationsTopicId: applicationsTopicId } =
      resolveTelegramTargets(this.configService);

    console.log(
      `Sending bot seller application to chat ${chatId}, topic ${applicationsTopicId}, bot id: ${botSeller.id}`,
    );
    const botSellerOwner = await this.botSellersService.getBotSellerOwner(
      botSeller.id,
    );

    // Кнопки подтверждения/отклонения
    const keyboardReplyMarkup = {
      inline_keyboard: [
        [
          {
            text: '✅ Подтвердить',
            callback_data: `confirm_bot_seller_application:${botSeller.id}`,
          },
          {
            text: '❌ Отклонить',
            callback_data: `reject_bot_seller_application:${botSeller.id}`,
          },
        ],
        [
          {
            text: '⏳ В ожидание',
            callback_data: `wait_bot_seller_application:${botSeller.id}`,
          },
        ],
        [
          {
            text: '📋 Выбрать категорию',
            callback_data: `select_category:${botSeller.id}`,
          },
        ],
      ],
    };

    // Статус с эмодзи
    let statusEmoji = '';
    switch (botSeller.acceptStatus) {
      case 'PENDING':
        statusEmoji = '🔶';
        break;
      case 'APPROVED':
        statusEmoji = '✅';
        break;
      case 'REJECTED':
        statusEmoji = '❌';
        break;
      case 'WAITING':
        statusEmoji = '⏳';
        break;
    }

    // Категория с эмодзи
    let categoryEmoji = '';
    switch (botSeller.category) {
      case 'GAMBLING':
        categoryEmoji = '🎰';
        break;
      case 'OTHER':
        categoryEmoji = '📦';
        break;
      case 'DATING':
        categoryEmoji = '💕';
        break;
      case 'GAMES':
        categoryEmoji = '🎮';
        break;
      case 'CRYPTO':
        categoryEmoji = '💰';
        break;
      case 'FUN':
        categoryEmoji = '🎭';
        break;
      case 'TECH':
        categoryEmoji = '🤖';
        break;
      case 'UTILITY':
        categoryEmoji = '🔧';
        break;
    }

    const getCategoryName = (category: string) => {
      const categories = {
        GAMBLING: 'Гэмблинг',
        OTHER: 'Другое',
        DATING: 'Знакомства',
        GAMES: 'Игры',
        CRYPTO: 'Крипто',
        FUN: 'Развлечения',
        TECH: 'Технологии/нейросети',
        UTILITY: 'Утилиты/Продуктивность',
      };
      return categories[category] || category;
    };

    const message =
      `<b>🤖 НОВАЯ ЗАЯВКА НА СОЗДАНИЕ БОТА</b>\n\n` +
      `<b>👤 Пользователь:</b> @${botSellerOwner.username}\n` +
      `<b>📅 Дата создания:</b> ${new Date(botSeller.createdAt).toLocaleString('ru-RU')}\n\n` +
      `<b>📝 Информация о боте:</b>\n` +
      `• <b>🔗Ссылка:</b> ${botSeller.link || '<i>Не указано</i>'}\n` +
      `• <b>Описание:</b> ${botSeller.description || '<i>Не указано</i>'}\n` +
      `• <b>Категория:</b> ${categoryEmoji} ${getCategoryName(botSeller.category)}\n\n` +
      `• <b>Цена:</b> ${statusEmoji} ${botSeller.fixedPrice}\n` +
      `<b>📊 Статистика:</b>\n` +
      `• <b>Активных пользователей:</b> ${botSeller.botLiveAudience || 0}\n` +
      `• <b>Активных в месяц:</b> ${botSeller.botMonthlyActiveUsers || 0}\n` +
      `• <b>Аудитория канала:</b> ${botSeller.channelAudience || 0}\n`;

    try {
      const sentMessage = await this.bot.telegram.sendMessage(chatId, message, {
        reply_markup: keyboardReplyMarkup,
        parse_mode: 'HTML',
        message_thread_id: applicationsTopicId,
      });

      console.log(
        `Bot seller application message sent successfully, message id: ${sentMessage.message_id}`,
      );
      return sentMessage;
    } catch (error) {
      console.error('Error sending bot seller application to Telegram:', error);
      throw new HttpException(
        'Failed to send bot seller application',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
