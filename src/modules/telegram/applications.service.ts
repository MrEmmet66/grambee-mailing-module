import { Injectable, HttpException, HttpStatus, forwardRef, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { Mailing, BotSeller, MailingReservation } from '@prisma/client';
import { MailingService } from '../mailing/services/mailing.service';
import { MailingPaymentService } from '../mailing/services/payment.service';
import { StatsService } from '../mailing/stats/stats.service';
import { MailingNotifyProps } from './telegram.types';
import { TelegramService } from './telegram.service';
import { ProcessorService } from '../mailing/services/processor.service';
import { BotSellersService } from '../bot_sellers';

@Injectable()
export class ApplicationsService {
    private botSellersService: BotSellersService;

    constructor(
        private configService: ConfigService,
        @Inject(forwardRef(() => MailingService))
        private readonly mailingService: MailingService,
        private readonly mailingPaymentService: MailingPaymentService,
        private readonly statsService: StatsService,
        private readonly telegramService: TelegramService,
        @Inject(forwardRef(() => ProcessorService))
        private readonly processorService: ProcessorService,
        @InjectBot() private readonly bot: Telegraf<Context>
    ) { }

    // This method will be called after all providers are resolved
    setBotSellersService(botSellersService: BotSellersService) {
        this.botSellersService = botSellersService;
    }

    async notifyAdminsAboutMailingExecution(props: MailingNotifyProps) {
        const chatId = this.configService.get<string>('ADMIN_CHAT_ID') || "-1002677251791";
        const notifyTopicId = this.configService.get<number>('MAILING_NOTIFY_TOPIC_ID') || 14;

        // Escape HTML utility
        const escape = (text: any) => String(text || '').replace(/[&<>]/g, t => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[t] || t));

        const message =
            `<b>🚀 Рассылка отправлена</b>\n\n` +
            `<b>Тип:</b> ${props.isChannel ? 'Канал' : 'Бот'}\n` +
            `<b>Стоимость:</b> ${props.paymentType === 'fixed' ? `Фиксированная (${escape(String(props.fixedPrice))}р)` : `Постоплата пдп (${escape(String(props.subscriberPrice))}$)`}\n` +
            `<b>Дата рекламы:</b> ${escape(props.mailingDate.toLocaleDateString())}\n` +
            `<b>Источник:</b> ${escape(props.botSellerLink)} @${escape(props.botSellerOwnerUsername || 'неизвестно')}\n` +
            `<b>Заказчик:</b> ${escape(props.mailingLink)} @${escape(props.mailingOwnerUsername || 'неизвестно')}`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: "👀 Посмотреть пост", callback_data: `view_post:${props.reservationId}` },
                    { text: "✅ Одобрить", callback_data: `approve_mailing_process:${props.reservationId}` }
                ],
                [
                    { text: "❄️ Заморозить", callback_data: `freeze_mailing_process:${props.reservationId}` },
                    { text: "📊 Статистика", callback_data: `stats:${props.reservationId}` }
                ]
            ]
        };

        await this.bot.telegram.sendMessage(chatId, message, {
            reply_markup: keyboard,
            parse_mode: 'HTML',
            message_thread_id: notifyTopicId,
        });

    }

    async sendNotification(telegramId: string, message: string) {
        try {
            await fetch(`${this.configService.get<string>('GATEWAY_URL')}/api/v1/notifications`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    telegramId,
                    message,
                }),
            });
        } catch (error) {
            console.error('Error sending notification:', error);
        }
    }

    async getUsernameByTelegramId(telegramId: number): Promise<string | null> {
        const chatId = await this.getChatIdByTelegramId(telegramId);
        const user = await this.bot.telegram.getChatMember(chatId, telegramId);
        return user && user.user ? user.user.username || null : null;
    }

    async getChatIdByTelegramId(telegramId: number): Promise<string> {
        const chat = await this.bot.telegram.getChat(telegramId);
        return chat ? chat.id.toString() : '';
    }

    async sendMailingApplication(mailing: Mailing) {
        const chatId = this.configService.get<string>('ADMIN_CHAT_ID') || "-1002677251791";
        const applicationsTopicId = this.configService.get<number>('MAILING_APPLICATIONS_TOPIC_ID') || 12;

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
                    }
                ]
            ]
        };

        // Display button text directly - no need for JSON parsing
        let buttonText = mailing.postButtons ? mailing.postButtons.toString() : 'Нет';

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
        const targetType = mailing.isChannel ? 'Канал' : 'Бот';
        const targetLink = mailing.link;

        const message =
            `<b>📨 НОВАЯ ЗАЯВКА НА РАССЫЛКУ</b>\n\n` +
            `<b>👤 Пользователь:</b> @${mailingOwner.username}\n` +
            `<b>🎯 Тип цели:</b> ${targetType}\n` +
            `<b>🔗 Ссылка:</b> ${targetLink}\n` +
            `<b>📅 Дата создания:</b> ${new Date().toLocaleString('ru-RU')}\n` +
            `<b>📝 Контент:</b>\n<pre>${mailing.postContent}</pre>\n\n` +
            (mailing.postMedia ?
                `<b>🖼 Медиа:</b> ${mailing.postMedia}\n` +
                `<b>📂 Тип медиа:</b> ${mailing.postMediaType || 'Не указан'}\n\n` :
                ''
            ) +
            `<b>🔘 Текст кнопки:</b> ${buttonText}`;

        try {
            const sentMessage = await this.bot.telegram.sendMessage(chatId, message, {
                reply_markup: keyboardReplyMarkup,
                parse_mode: 'HTML',
                message_thread_id: applicationsTopicId,
            });
            console.log(`Mailing application message sent successfully, message id: ${sentMessage.message_id}`);
            return sentMessage;
        } catch (error) {
            console.error('Error sending message to Telegram:', error);
            throw new HttpException('Failed to send message', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async sendBotSellerApplication(botSeller: BotSeller) {
        const chatId = this.configService.get<string>('ADMIN_CHAT_ID') || "-1002677251791";
        const applicationsTopicId = this.configService.get<number>('BOT_APPLICATIONS_TOPIC_ID') || 9;

        console.log(`Sending bot seller application to chat ${chatId}, topic ${applicationsTopicId}, bot id: ${botSeller.id}`);
        const botSellerOwner = await this.botSellersService.getBotSellerOwner(botSeller.id);

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
                    }
                ],
                [
                    { text: '📋 Выбрать категорию', callback_data: `select_category:${botSeller.id}` }
                ]
            ]
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
                'GAMBLING': 'Гэмблинг',
                'OTHER': 'Другое',
                'DATING': 'Знакомства',
                'GAMES': 'Игры',
                'CRYPTO': 'Крипто',
                'FUN': 'Развлечения',
                'TECH': 'Технологии/нейросети',
                'UTILITY': 'Утилиты/Продуктивность'
            };
            return categories[category] || category;
        };

        const message =
            `<b>🤖 НОВАЯ ЗАЯВКА НА СОЗДАНИЕ БОТА</b>\n\n` +
            `<b>👤 Пользователь:</b> @${botSellerOwner.username}\n` +
            `<b>📅 Дата создания:</b> ${new Date(botSeller.createdAt).toLocaleString('ru-RU')}\n\n` +
            `<b>📝 Информация о боте:</b>\n` +
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

            console.log(`Bot seller application message sent successfully, message id: ${sentMessage.message_id}`);
            return sentMessage;
        } catch (error) {
            console.error('Error sending bot seller application to Telegram:', error);
            throw new HttpException('Failed to send bot seller application', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async setupCallbackHandlers() {
        // Удаляем предыдущие обработчики чтобы избежать дублирования
        this.bot.telegram.deleteMyCommands();

        // Регистрируем обработчики с правильным форматом
        this.bot.action(/confirm_mailing_application:(\d+)/, (ctx) => this.handleConfirmMailing(ctx));
        this.bot.action(/reject_mailing_application:(\d+)/, (ctx) => this.handleRejectMailing(ctx));
        this.bot.action(/wait_mailing_application:(\d+)/, (ctx) => this.handleWaitMailing(ctx));

        // Add handlers for bot seller applications
        this.bot.action(/confirm_bot_seller_application:(\d+)/, (ctx) => this.handleConfirmBotSeller(ctx));
        this.bot.action(/reject_bot_seller_application:(\d+)/, (ctx) => this.handleRejectBotSeller(ctx));
        this.bot.action(/wait_bot_seller_application:(\d+)/, (ctx) => this.handleWaitBotSeller(ctx));

        // Обработчик выбора категории
        this.bot.action(/select_category:(\d+)/, (ctx) => this.handleCategorySelection(ctx));

        // Обработчики установки категории
        this.bot.action(/set_category:(\d+):(.+)/, (ctx) => this.handleSetCategory(ctx));

        // Обработчик кнопки "Назад"
        this.bot.action(/back_to_application:(\d+)/, (ctx) => this.handleBackToApplication(ctx));

        // NEW: Add handlers for mailing execution notification buttons
        this.bot.action(/view_post:(\d+)/, (ctx) => this.handleViewPost(ctx));
        this.bot.action(/approve_mailing_process:(\d+)/, (ctx) => this.handleApproveMailingProcess(ctx));
        this.bot.action(/freeze_mailing_process:(\d+)/, (ctx) => this.handleFreezeMailingProcess(ctx));
        this.bot.action(/stats:(\d+)/, (ctx) => this.handleGetStatistics(ctx));

        // NEW: Confirmation handlers
        this.bot.action(/confirm_approve:(\d+)/, (ctx) => this.handleConfirmApprove(ctx));
        this.bot.action(/confirm_freeze:(\d+)/, (ctx) => this.handleConfirmFreeze(ctx));
        this.bot.action(/cancel_action:(\d+)/, (ctx) => this.handleCancelAction(ctx));

        console.log('Application callback handlers setup completed');
    }

    private async handleConfirmMailing(ctx: Context) {
        try {
            const mailingId = this.extractMailingId(ctx);
            console.log(`Confirming mailing application: ${mailingId}`);

            // Update the mailing status in the database (заменено на processorService)
            await this.processorService.updateMailingStatus(Number(mailingId), 'APPROVED');

            await ctx.answerCbQuery(`✅ Заявка на рассылку #${mailingId} подтверждена`);

            const message =
                `<b>✅ ЗАЯВКА НА РАССЫЛКУ ПОДТВЕРЖДЕНА</b>\n\n` +
                `<b>🆔 ID заявки:</b> #${mailingId}\n` +
                `<b>🕒 Время обработки:</b> ${new Date().toLocaleString('ru-RU')}\n\n`

            await ctx.editMessageText(message, {
                reply_markup: undefined,
                parse_mode: 'HTML'
            });

            const mailingOwnerTelegramId = await this.mailingService.getMailingOwnerTelegramId(Number(mailingId));
            const mailing = await this.mailingService.getMailingById(Number(mailingId));
            const notificationMessage =
                `— Статус модерации:\n` +
                `Рассылка ${mailing.link}\n\n` +
                `Ваша рассылка была успешно одобрена.`;

            await this.sendNotification(mailingOwnerTelegramId, notificationMessage);

            await this.telegramService.notifyUser(mailingOwnerTelegramId, notificationMessage);

            return true;
        } catch (error) {
            console.error('Error confirming mailing:', error);
            try {
                await ctx.answerCbQuery('Произошла ошибка при подтверждении заявки на рассылку');
            } catch (cbError) {
                console.error('Error sending callback answer:', cbError);
            }
            return false;
        }
    }

    private async handleRejectMailing(ctx: Context) {
        try {
            const mailingId = this.extractMailingId(ctx);
            console.log(`Rejecting mailing application: ${mailingId}`);

            // Update the mailing status in the database (заменено на processorService)
            await this.processorService.updateMailingStatus(Number(mailingId), 'REJECTED');

            await ctx.answerCbQuery(`❌ Заявка на рассылку #${mailingId} отклонена`);

            const message =
                `<b>❌ ЗАЯВКА НА РАССЫЛКУ ОТКЛОНЕНА</b>\n\n` +
                `<b>🆔 ID заявки:</b> #${mailingId}\n` +
                `<b>🕒 Время обработки:</b> ${new Date().toLocaleString('ru-RU')}\n\n` +
                `<i>Рассылка была отклонена. Пользователь может отправить новую заявку.</i>`;

            await ctx.editMessageText(message, {
                reply_markup: undefined,
                parse_mode: 'HTML'
            });
            const mailingOwnerTelegramId = await this.mailingService.getMailingOwnerTelegramId(Number(mailingId));

            const mailing = await this.mailingService.getMailingById(Number(mailingId));
            const notificationMessage =
                `— Статус модерации:\n` +
                `Рассылка ${mailing.link}\n\n` +
                `Ваша рассылка была отклонена.`;

            await this.sendNotification(mailingOwnerTelegramId, notificationMessage);

            await this.telegramService.notifyUser(mailingOwnerTelegramId, notificationMessage);

            return true;
        } catch (error) {
            console.error('Error rejecting mailing:', error);
            try {
                await ctx.answerCbQuery('Произошла ошибка при отклонении заявки на рассылку');
            } catch (cbError) {
                console.error('Error sending callback answer:', cbError);
            }
            return false;
        }
    }

    private async handleWaitMailing(ctx: Context) {
        try {
            const mailingId = this.extractMailingId(ctx);
            console.log(`Setting mailing application to waiting: ${mailingId}`);

            // Update the mailing status in the database (заменено на processorService)
            await this.processorService.updateMailingStatus(Number(mailingId), 'WAITING');

            await ctx.answerCbQuery(`⏳ Заявка на рассылку #${mailingId} отправлена в ожидание`);

            const message =
                `<b>⏳ ЗАЯВКА НА РАССЫЛКУ ОТЛОЖЕНА</b>\n\n` +
                `<b>🆔 ID заявки:</b> #${mailingId}\n` +
                `<b>🕒 Время обработки:</b> ${new Date().toLocaleString('ru-RU')}\n\n` +
                `<i>Заявка перемещена в статус ожидания для дополнительной проверки.</i>`;

            await ctx.editMessageText(message, {
                reply_markup: undefined,
                parse_mode: 'HTML'
            });

            const mailingOwnerTelegramId = await this.mailingService.getMailingOwnerTelegramId(Number(mailingId));

            const mailing = await this.mailingService.getMailingById(Number(mailingId));
            const notificationMessage =
                `— Статус модерации:\n` +
                `Рассылка ${mailing.link}\n\n` +
                `Ваша рассылка была отправлена в ожидание.`;

            await this.sendNotification(mailingOwnerTelegramId, notificationMessage);

            await this.telegramService.notifyUser(mailingOwnerTelegramId, notificationMessage);

            return true;
        } catch (error) {
            console.error('Error putting mailing on hold:', error);
            try {
                await ctx.answerCbQuery('Произошла ошибка при изменении статуса заявки на рассылку');
            } catch (cbError) {
                console.error('Error sending callback answer:', cbError);
            }
            return false;
        }
    }

    private async handleConfirmBotSeller(ctx: Context) {
        try {
            const botSellerId = this.extractBotSellerId(ctx);
            console.log(`Confirming bot seller application: ${botSellerId}`);

            // Сначала обновим статус в базе данных
            if (this.botSellersService) {
                try {
                    await this.botSellersService.updateStatus(Number(botSellerId), 'APPROVED');
                    console.log(`Bot seller ${botSellerId} status updated to APPROVED`);
                } catch (error) {
                    console.error(`Error updating bot seller status in database: ${error.message}`);
                    await ctx.answerCbQuery(`Ошибка обновления статуса в базе данных: ${error.message}`);
                    return false;
                }
            } else {
                console.warn('botSellersService not set, unable to update status');
                await ctx.answerCbQuery('Сервис обработки ботов недоступен, попробуйте позже');
                return false;
            }

            // Затем обновим сообщение в телеграме
            await ctx.answerCbQuery(`✅ Заявка на бота #${botSellerId} подтверждена`);

            const message =
                `<b>✅ ЗАЯВКА ПОДТВЕРЖДЕНА</b>\n\n` +
                `<b>🆔 ID заявки:</b> #${botSellerId}\n` +
                `<b>🕒 Время обработки:</b> ${new Date().toLocaleString('ru-RU')}\n\n` +
                `<i>Бот был добавлен в систему и теперь активен.</i>`;

            await ctx.editMessageText(message, {
                reply_markup: undefined,
                parse_mode: 'HTML'
            });

            const botSeller = await this.botSellersService.findOne(Number(botSellerId));
            if (!botSeller) {
                console.error(`Bot seller with ID ${botSellerId} not found`);
                await ctx.answerCbQuery('Бот не найден в базе данных');
                return false;
            }
            const botSellerOwnerTelegramId = await this.botSellersService.getBotSellerOwnerTelegramId(Number(botSellerId));
            const notificationMessage =
                `— Статус модерации:\n` +
                `${botSeller?.isChannel ? 'Канал' : 'Бот'} ${botSeller.link}\n\n` +
                `Ваша заявка была успешно одобрена.`;

            await this.sendNotification(botSellerOwnerTelegramId, notificationMessage);

            await this.telegramService.notifyUser(botSellerOwnerTelegramId, notificationMessage);

            return true;
        } catch (error) {
            console.error('Error confirming bot seller application:', error);
            try {
                await ctx.answerCbQuery('Произошла ошибка при подтверждении заявки на бота');
            } catch (cbError) {
                console.error('Error sending callback answer:', cbError);
            }
            return false;
        }
    }

    private async handleRejectBotSeller(ctx: Context) {
        try {
            const botSellerId = this.extractBotSellerId(ctx);
            console.log(`Rejecting bot seller application: ${botSellerId}`);

            // Сначала обновим статус в базе данных
            if (this.botSellersService) {
                try {
                    await this.botSellersService.updateStatus(Number(botSellerId), 'REJECTED');
                    console.log(`Bot seller ${botSellerId} status updated to REJECTED`);
                } catch (error) {
                    console.error(`Error updating bot seller status in database: ${error.message}`);
                    await ctx.answerCbQuery(`Ошибка обновления статуса в базе данных: ${error.message}`);
                    return false;
                }
            } else {
                console.warn('botSellersService not set, unable to update status');
                await ctx.answerCbQuery('Сервис обработки ботов недоступен, попробуйте позже');
                return false;
            }

            // Затем обновим сообщение в телеграме
            await ctx.answerCbQuery(`❌ Заявка на бота #${botSellerId} отклонена`);

            const message =
                `<b>❌ ЗАЯВКА ОТКЛОНЕНА</b>\n\n` +
                `<b>🆔 ID заявки:</b> #${botSellerId}\n` +
                `<b>🕒 Время обработки:</b> ${new Date().toLocaleString('ru-RU')}\n\n` +
                `<i>Бот был отклонен. Пользователь может отправить новую заявку.</i>`;

            await ctx.editMessageText(message, {
                reply_markup: undefined,
                parse_mode: 'HTML'
            });

            const botSeller = await this.botSellersService.findOne(Number(botSellerId));
            if (!botSeller) {
                console.error(`Bot seller with ID ${botSellerId} not found`);
                await ctx.answerCbQuery('Бот не найден в базе данных');
                return false;
            }
            const botSellerOwnerTelegramId = await this.botSellersService.getBotSellerOwnerTelegramId(Number(botSellerId));
            const notificationMessage =
                `— Статус модерации:\n` +
                `${botSeller?.isChannel ? 'Канал' : 'Бот'} ${botSeller.link}\n\n` +
                `Ваша заявка была отклонена.`;

            await this.sendNotification(botSellerOwnerTelegramId, notificationMessage);

            await this.telegramService.notifyUser(botSellerOwnerTelegramId, notificationMessage);

            return true;
        } catch (error) {
            console.error('Error rejecting bot seller application:', error);
            try {
                await ctx.answerCbQuery('Произошла ошибка при отклонении заявки на бота');
            } catch (cbError) {
                console.error('Error sending callback answer:', cbError);
            }
            return false;
        }
    }

    private async handleWaitBotSeller(ctx: Context) {
        try {
            const botSellerId = this.extractBotSellerId(ctx);
            console.log(`Setting bot seller application to waiting: ${botSellerId}`);

            // Сначала обновим статус в базе данных
            if (this.botSellersService) {
                try {
                    await this.botSellersService.updateStatus(Number(botSellerId), 'WAITING');
                    console.log(`Bot seller ${botSellerId} status updated to WAITING`);
                } catch (error) {
                    console.error(`Error updating bot seller status in database: ${error.message}`);
                    await ctx.answerCbQuery(`Ошибка обновления статуса в базе данных: ${error.message}`);
                    return false;
                }
            } else {
                console.warn('botSellersService not set, unable to update status');
                await ctx.answerCbQuery('Сервис обработки ботов недоступен, попробуйте позже');
                return false;
            }

            // Затем обновим сообщение в телеграме
            await ctx.answerCbQuery(`⏳ Заявка на бота #${botSellerId} отправлена в ожидание`);

            const message =
                `<b>⏳ ЗАЯВКА ОТЛОЖЕНА</b>\n\n` +
                `<b>🆔 ID заявки:</b> #${botSellerId}\n` +
                `<b>🕒 Время обработки:</b> ${new Date().toLocaleString('ru-RU')}\n\n` +
                `<i>Заявка перемещена в статус ожидания для дополнительной проверки.</i>`;

            await ctx.editMessageText(message, {
                reply_markup: undefined,
                parse_mode: 'HTML'
            });

            const botSeller = await this.botSellersService.findOne(Number(botSellerId));
            if (!botSeller) {
                console.error(`Bot seller with ID ${botSellerId} not found`);
                await ctx.answerCbQuery('Бот не найден в базе данных');
                return false;
            }
            const botSellerOwnerTelegramId = await this.botSellersService.getBotSellerOwnerTelegramId(Number(botSellerId));
            const notificationMessage =
                `— Статус модерации:\n` +
                `${botSeller?.isChannel ? 'Канал' : 'Бот'} ${botSeller.link}\n\n` +
                `Ваша заявка была отправлена в ожидание.`;

            await this.sendNotification(botSellerOwnerTelegramId, notificationMessage);

            await this.telegramService.notifyUser(botSellerOwnerTelegramId, notificationMessage);

            return true;
        } catch (error) {
            console.error('Error putting bot seller application on hold:', error);
            try {
                await ctx.answerCbQuery('Произошла ошибка при изменении статуса заявки на бота');
            } catch (cbError) {
                console.error('Error sending callback answer:', cbError);
            }
            return false;
        }
    }

    // Обработчик для показа меню выбора категории
    private async handleCategorySelection(ctx: Context) {
        try {
            const botSellerId = this.extractBotSellerId(ctx);
            console.log(`Showing category selection menu for bot seller: ${botSellerId}`);

            const keyboardMarkup = {
                inline_keyboard: [
                    [
                        { text: '🎰 Гэмблинг', callback_data: `set_category:${botSellerId}:GAMBLING` },
                        { text: '💕 Знакомства', callback_data: `set_category:${botSellerId}:DATING` }
                    ],
                    [
                        { text: '🎮 Игры', callback_data: `set_category:${botSellerId}:GAMES` },
                        { text: '💰 Крипто', callback_data: `set_category:${botSellerId}:CRYPTO` }
                    ],
                    [
                        { text: '🎭 Развлечения', callback_data: `set_category:${botSellerId}:FUN` },
                        { text: '🤖 Технологии', callback_data: `set_category:${botSellerId}:TECH` }
                    ],
                    [
                        { text: '🔧 Утилиты', callback_data: `set_category:${botSellerId}:UTILITY` },
                        { text: '📦 Другое', callback_data: `set_category:${botSellerId}:OTHER` }
                    ],
                    [
                        { text: '🔙 Назад', callback_data: `back_to_application:${botSellerId}` }
                    ]
                ]
            };

            await ctx.answerCbQuery('Выберите категорию для бота');
            await ctx.editMessageReplyMarkup(keyboardMarkup as any);

            return true;
        } catch (error) {
            console.error('Error showing category selection:', error);
            try {
                await ctx.answerCbQuery('Произошла ошибка при выборе категории');
            } catch (cbError) {
                console.error('Error sending callback answer:', cbError);
            }
            return false;
        }
    }

    // Обработчик для установки выбранной категории
    private async handleSetCategory(ctx: Context) {
        try {
            // Извлекаем ID бота и категорию из колбэка
            const callbackData = (ctx.callbackQuery as any).data;
            const match = callbackData.match(/set_category:(\d+):(.+)/);

            if (!match || match.length < 3) {
                throw new Error(`Invalid callback data format: ${callbackData}`);
            }

            const botSellerId = match[1];
            const category = match[2];

            console.log(`Setting category ${category} for bot seller ${botSellerId}`);

            // Обновляем категорию в базе данных
            if (this.botSellersService) {
                try {
                    await this.botSellersService.updateCategory(Number(botSellerId), category);
                    console.log(`Bot seller ${botSellerId} category updated to ${category}`);
                } catch (error) {
                    console.error(`Error updating bot seller category in database: ${error.message}`);
                    await ctx.answerCbQuery(`Ошибка обновления категории в базе данных: ${error.message}`);
                    return false;
                }
            } else {
                console.warn('botSellersService not set, unable to update category');
                await ctx.answerCbQuery('Сервис обработки ботов недоступен, попробуйте позже');
                return false;
            }

            // Получаем обновленную информацию о боте
            const botSeller = await this.botSellersService.findOne(Number(botSellerId));

            if (!botSeller) {
                console.error(`Bot seller with ID ${botSellerId} not found`);
                await ctx.answerCbQuery('Бот не найден в базе данных');
                return false;
            }

            // Отправляем обновленное сообщение заявки
            await this.sendBotSellerApplication(botSeller);

            // Удаляем текущее сообщение с меню категорий
            await ctx.deleteMessage();

            await ctx.answerCbQuery(`Категория бота изменена на: ${category}`);

            return true;
        } catch (error) {
            console.error('Error setting category:', error);
            try {
                await ctx.answerCbQuery('Произошла ошибка при установке категории');
            } catch (cbError) {
                console.error('Error sending callback answer:', cbError);
            }
            return false;
        }
    }

    // Обработчик для возврата к исходному меню заявки
    private async handleBackToApplication(ctx: Context) {
        try {
            const botSellerId = this.extractBotSellerId(ctx);
            console.log(`Returning to application for bot seller: ${botSellerId}`);

            // Получаем обновленную информацию о боте
            const botSeller = await this.botSellersService.findOne(Number(botSellerId));

            if (!botSeller) {
                console.error(`Bot seller with ID ${botSellerId} not found`);
                await ctx.answerCbQuery('Бот не найден в базе данных');
                return false;
            }

            // Отправляем обновленное сообщение заявки
            await this.sendBotSellerApplication(botSeller);
            

            // Удаляем текущее сообщение с меню категорий
            await ctx.deleteMessage();

            await ctx.answerCbQuery('Возврат к заявке');

            return true;
        } catch (error) {
            console.error('Error returning to application:', error);
            try {
                await ctx.answerCbQuery('Произошла ошибка при возврате к заявке');
            } catch (cbError) {
                console.error('Error sending callback answer:', cbError);
            }
            return false;
        }
    }

    private extractMailingId(ctx: Context): string {
        if (!ctx.callbackQuery) {
            throw new Error('Callback query is undefined');
        }

        console.log('Callback query:', ctx.callbackQuery);

        // Проверим наличие data в колбэке
        const callbackData = (ctx.callbackQuery as any).data;
        if (!callbackData) {
            throw new Error('Callback query data is undefined');
        }

        // Извлекаем ID из data
        const match = callbackData.match(/\d+$/);
        if (match) {
            const id = match[0];
            console.log(`Extracted mailing ID: ${id}`);
            return id;
        }

        // Если дошли сюда, значит не смогли извлечь ID
        console.error('Could not extract ID from callback data:', callbackData);
        throw new Error(`Could not extract mailing ID from callback query data: ${callbackData}`);
    }

    private extractBotSellerId(ctx: Context): string {
        if (!ctx.callbackQuery) {
            throw new Error('Callback query is undefined');
        }

        console.log('Callback query:', ctx.callbackQuery);

        // Проверим наличие data в колбэке
        const callbackData = (ctx.callbackQuery as any).data;
        if (!callbackData) {
            throw new Error('Callback query data is undefined');
        }

        // Извлекаем ID из data
        const match = callbackData.match(/\d+$/);
        if (match) {
            const id = match[0];
            console.log(`Extracted bot seller ID: ${id}`);
            return id;
        }

        // Если дошли сюда, значит не смогли извлечь ID
        console.error('Could not extract ID from callback data:', callbackData);
        throw new Error(`Could not extract bot seller ID from callback query data: ${callbackData}`);
    }

    // NEW: Handlers for mailing execution notification
    private async handleViewPost(ctx: Context) {
        try {
            const reservationId = this.extractReservationId(ctx);
            console.log(`Viewing post for reservation: ${reservationId}`);

            const reservation = await this.statsService.getMailingReservationDetails(Number(reservationId));
            if (!reservation) {
                await ctx.answerCbQuery('Резервация не найдена');
                return;
            }

            const mailing = reservation.mailing;
            let postMessage = `📝 **Пост рассылки #${mailing.id}**\n\n`;
            postMessage += `**Контент:**\n${mailing.postContent}\n\n`;

            if (mailing.postButtons) {
                postMessage += `**Кнопки:**\n${mailing.postButtons}\n\n`;
            }

            if (mailing.postMedia) {
                postMessage += `**Медиа:** ${mailing.postMedia}\n`;
                postMessage += `**Тип медиа:** ${mailing.postMediaType || 'Не указан'}`;
            }

            // Send to admin privately
            const adminId = ctx.from?.id;
            if (adminId) {
                await this.bot.telegram.sendMessage(adminId, postMessage, { parse_mode: 'Markdown' });
                await ctx.answerCbQuery('Пост отправлен в ЛС');
            }
        } catch (error) {
            console.error('Error viewing post:', error);
            await ctx.answerCbQuery('Ошибка при просмотре поста');
        }
    }

    private async handleApproveMailingProcess(ctx: Context) {
        try {
            const reservationId = this.extractReservationId(ctx);
            console.log(`Requesting approval confirmation for reservation: ${reservationId}`);

            const confirmationKeyboard = {
                inline_keyboard: [
                    [
                        { text: "✅ Подтвердить одобрение", callback_data: `confirm_approve:${reservationId}` },
                        { text: "❌ Отмена", callback_data: `cancel_action:${reservationId}` }
                    ]
                ]
            };

            await ctx.answerCbQuery('Подтвердите одобрение');
            await ctx.editMessageReplyMarkup(confirmationKeyboard as any);

        } catch (error) {
            console.error('Error requesting approval confirmation:', error);
            await ctx.answerCbQuery('Ошибка при запросе подтверждения');
        }
    }

    private async handleFreezeMailingProcess(ctx: Context) {
        try {
            const reservationId = this.extractReservationId(ctx);
            console.log(`Requesting freeze confirmation for reservation: ${reservationId}`);

            const confirmationKeyboard = {
                inline_keyboard: [
                    [
                        { text: "❄️ Подтвердить заморозку", callback_data: `confirm_freeze:${reservationId}` },
                        { text: "❌ Отмена", callback_data: `cancel_action:${reservationId}` }
                    ]
                ]
            };

            await ctx.answerCbQuery('Подтвердите заморозку');
            await ctx.editMessageReplyMarkup(confirmationKeyboard as any);

        } catch (error) {
            console.error('Error requesting freeze confirmation:', error);
            await ctx.answerCbQuery('Ошибка при запросе подтверждения');
        }
    }

    private async handleGetStatistics(ctx: Context) {
        const botToken = this.configService.get<string>('MAIN_BOT');
        const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
        try {
            const reservationId = this.extractReservationId(ctx);
            console.log(`Getting statistics for reservation: ${reservationId}`);

            const reservation = await this.statsService.getMailingReservationDetails(Number(reservationId));
            if (!reservation) {
                await ctx.answerCbQuery('Резервация не найдена');
                return;
            }

            let statsMessage: string;

            if (reservation.botSeller.isChannel) {
                await this.mailingService.updateChannelViews(reservation);
                const channelStats = await this.statsService.getChannelStatistics(Number(reservationId));
                statsMessage = await this.statsService.formatChannelStatistics(channelStats);
            } else {
                const botStats = await this.statsService.getBotStatistics(Number(reservationId));
                statsMessage = await this.statsService.formatBotStatistics(botStats, Number(reservationId));
            }

            // Send statistics to admin privately via Telegram Bot API
            const adminId = ctx.from?.id;
            if (adminId) {
                await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: adminId,
                        text: statsMessage,
                        parse_mode: 'HTML'
                    })
                });
                await ctx.answerCbQuery('Статистика отправлена в ЛС');
            }

        } catch (error) {
            console.error('Error getting statistics:', error);
            await ctx.answerCbQuery('Ошибка при получении статистики');
        }
    }
    private async handleConfirmApprove(ctx: Context) {
        try {
            const reservationId = this.extractReservationId(ctx);
            console.log(`Confirming approval for reservation: ${reservationId}`);

            const result = await this.mailingPaymentService.approveMailingPayment(Number(reservationId));

            // Get reservation details for notifications
            const reservation = await this.statsService.getMailingReservationDetails(Number(reservationId));

            // Send notifications to customer and seller
            if (reservation) {
                await this.sendApprovalNotifications(reservation, result);
            }

            const successMessage = `
✅ **РАССЫЛКА ОДОБРЕНА И ОПЛАЧЕНА**

🆔 **ID резервации:** #${reservationId}
💰 **Итого к оплате:** ${result.totalPayment}р
👤 **Продавцу:** ${result.sellerAmount}р  
🏢 **Комиссия сервиса:** ${result.serviceCommission}р
📊 **Переходов:** ${result.entranceCount}
🔒 **Было в холде:** ${result.originalHold}р
${result.additionalCharge > 0 ? `💳 **Доплачено:** ${result.additionalCharge}р` : ''}

🕒 **Время обработки:** ${new Date().toLocaleString('ru-RU')}

📱 **Уведомления отправлены:** заказчику и исполнителю
            `;

            await ctx.editMessageText(successMessage, {
                reply_markup: undefined,
                parse_mode: 'Markdown'
            });

            await ctx.answerCbQuery('✅ Рассылка успешно одобрена и оплачена');

        } catch (error) {
            console.error('Error confirming approval:', error);
            await ctx.answerCbQuery(`Ошибка при одобрении: ${error.message}`);

            // Restore original keyboard on error
            await this.restoreOriginalKeyboard(ctx, this.extractReservationId(ctx));
        }
    } private async handleConfirmFreeze(ctx: Context) {
        try {
            const reservationId = this.extractReservationId(ctx);
            console.log(`Confirming freeze for reservation: ${reservationId}`);

            const freezeReason = 'Заморожена администратором для подробного рассмотрения';
            await this.mailingPaymentService.freezeMailingPayment(Number(reservationId), freezeReason);

            // Get reservation details for notifications
            const reservation = await this.statsService.getMailingReservationDetails(Number(reservationId));

            // Send notifications to customer and seller
            if (reservation) {
                await this.sendFreezeNotifications(reservation, freezeReason);
            }

            const freezeMessage = `
❄️ **РАССЫЛКА ЗАМОРОЖЕНА**

🆔 **ID резервации:** #${reservationId}
🕒 **Время заморозки:** ${new Date().toLocaleString('ru-RU')}
📝 **Причина:** ${freezeReason}

💰 **Деньги не списаны** и остаются в холде до решения администрации.
📱 **Уведомления отправлены:** заказчику и исполнителю
            `;

            await ctx.editMessageText(freezeMessage, {
                reply_markup: undefined,
                parse_mode: 'Markdown'
            });

            await ctx.answerCbQuery('❄️ Рассылка заморожена, уведомления отправлены');

        } catch (error) {
            console.error('Error confirming freeze:', error);
            await ctx.answerCbQuery(`Ошибка при заморозке: ${error.message}`);

            // Restore original keyboard on error
            await this.restoreOriginalKeyboard(ctx, this.extractReservationId(ctx));
        }
    }

    private async handleCancelAction(ctx: Context) {
        try {
            const reservationId = this.extractReservationId(ctx);
            console.log(`Cancelling action for reservation: ${reservationId}`);

            await this.restoreOriginalKeyboard(ctx, reservationId);
            await ctx.answerCbQuery('Действие отменено');

        } catch (error) {
            console.error('Error cancelling action:', error);
            await ctx.answerCbQuery('Ошибка при отмене действия');
        }
    } private async restoreOriginalKeyboard(ctx: Context, reservationId: string) {
        const originalKeyboard = {
            inline_keyboard: [
                [
                    { text: "👀 Посмотреть пост", callback_data: `view_post:${reservationId}` },
                    { text: "✅ Одобрить", callback_data: `approve_mailing_process:${reservationId}` }
                ],
                [
                    { text: "❄️ Заморозить", callback_data: `freeze_mailing_process:${reservationId}` },
                    { text: "📊 Статистика", callback_data: `stats:${reservationId}` }
                ]
            ]
        };

        await ctx.editMessageReplyMarkup(originalKeyboard as any);
    }

    // ✅ Новый метод для отправки уведомлений об одобрении
    private async sendApprovalNotifications(reservation: any, paymentResult: any) {
        const botToken = this.configService.get<string>('MAIN_BOT', '');
        const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
        try {
            // Уведомление заказчику (владельцу рассылки)
            const customerMessage = `
 — Итоги рассылки:

 **Списано с баланса:** ${paymentResult.totalPayment}$
 **Показов зафиксировано:** ${paymentResult.entranceCount}
 **Было в холде:** ${paymentResult.originalHold}$
${paymentResult.additionalCharge > 0 ? `💳 **Доплачено:** ${paymentResult.additionalCharge}$` : ''}

 **Дата рассылки:** ${reservation.date.toLocaleDateString('ru-RU')}
 **Тип рекламы:** ${reservation.botSeller.isChannel ? 'Канал' : 'Бот'}
            `;

            // Уведомление исполнителю (владельцу бота)
            const sellerMessage = `
— Оплата за рассылку:

**Зачислено на баланс:** ${paymentResult.sellerAmount}$
**Показов зафиксировано:** ${paymentResult.entranceCount}

**Дата рассылки:** ${reservation.date.toLocaleDateString('ru-RU')}
**Тип рекламы:** ${reservation.botSeller.isChannel ? 'Канал' : 'Бот'}
`;

            // Отправляем уведомления через Telegram Bot API
            await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: reservation.mailing.user.telegramId,
                    text: customerMessage,
                    parse_mode: 'Markdown'
                })
            });
            await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: reservation.botSeller.user.telegramId,
                    text: sellerMessage,
                    parse_mode: 'Markdown'
                })
            });


            console.log(`Approval notifications sent for reservation ${reservation.id}`);
        } catch (error) {
            console.error('Error sending approval notifications:', error);
        }
    }

    // ✅ Новый метод для отправки уведомлений о заморозке
    private async sendFreezeNotifications(reservation: any, reason: string) {
        const botToken = this.configService.get<string>('MAIN_BOT', '');
        const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
        try {
            // Уведомление заказчику (владельцу рассылки)
            const customerMessage = `
 **ВАША РЕКЛАМА ЗАМОРОЖЕНА**

**Дата рассылки:** ${reservation.date.toLocaleDateString('ru-RU')}
**Тип рекламы:** ${reservation.botSeller.isChannel ? 'Канал' : 'Бот'}

**Причина:** ${reason}
**Деньги не списаны** и остаются в холде до решения администрации.

Администрация рассмотрит вашу рекламу дополнительно. Ожидайте решения.
            `;

            // Уведомление исполнителю (владельцу бота)
            const sellerMessage = `
❄️ **РЕКЛАМА ЗАМОРОЖЕНА**

**Дата рассылки:** ${reservation.date.toLocaleDateString('ru-RU')}
**Тип рекламы:** ${reservation.botSeller.isChannel ? 'Канал' : 'Бот'}

**Причина:** ${reason}

💰 **Оплата приостановлена** до решения администрации.

Администрация рассмотрит рекламу дополнительно. Ожидайте решения.
            `;

            // Отправляем уведомления через Telegram Bot API
            await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: reservation.mailing.user.telegramId,
                    text: customerMessage,
                    parse_mode: 'Markdown'
                })
            });
            await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: reservation.botSeller.user.telegramId,
                    text: sellerMessage,
                    parse_mode: 'Markdown'
                })
            });

            console.log(`Freeze notifications sent for reservation ${reservation.id}`);
        } catch (error) {
            console.error('Error sending freeze notifications:', error);
        }
    }

    private extractReservationId(ctx: Context): string {
        if (!ctx.callbackQuery) {
            throw new Error('Callback query is undefined');
        }

        const callbackData = (ctx.callbackQuery as any).data;
        if (!callbackData) {
            throw new Error('Callback query data is undefined');
        }

        // Extract ID from callback data
        const match = callbackData.match(/:(\d+)$/);
        if (match) {
            const id = match[1];
            console.log(`Extracted reservation ID: ${id}`);
            return id;
        }

        throw new Error(`Could not extract reservation ID from callback query data: ${callbackData}`);
    }
}
