import { Injectable, HttpException, HttpStatus, forwardRef, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { Mailing, BotSeller, MailingReservation } from '@prisma/client';
import { MailingService } from '../mailing/services/mailing.service';
import { MailingNotifyProps } from './telegram.types';

@Injectable()
export class ApplicationsService {
    private botSellersService: any;

    constructor(
        private configService: ConfigService,
        @Inject(forwardRef(() => MailingService))
        private readonly mailingService: MailingService,
        @InjectBot() private readonly bot: Telegraf<Context>
    ) { }
t
    // This method will be called after all providers are resolved
    setBotSellersService(botSellersService: any) {
        this.botSellersService = botSellersService;
    }

    async notifyAdminsAboutMailingExecution(props: MailingNotifyProps) {
        const chatId = this.configService.get<string>('ADMIN_CHAT_ID') || "-1002677251791";
        const notifyTopicId = this.configService.get<number>('MAILING_NOTIFY_TOPIC_ID') || 14;

        const message = `
            🚀 **Рассылка отправлена**

            **Тип:** ${props.isChannel ? 'Канал' : 'Бот'}
            **Стоимость:** ${props.paymentType === 'fixed' ? `Фиксированная (${props.fixedPrice}р)` : `Постоплата пдп (${props.subscriberPrice}р)`}
            **Дата рекламы:** ${props.mailingDate.toLocaleDateString()}
            **Источник:** ${props.botSellerLink} @${props.botSellerOwnerUsername || 'неизвестно'}
            **Заказчик:** ${props.mailingLink} @${props.mailingOwnerUsername || 'неизвестно'}`;

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
        reply_markup: keyboard
    });
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
        const targetId = mailing.isChannel ? mailing.channelId : mailing.botLink || 'Не указана';
        const targetLink = mailing.isChannel ? 'Недоступно для канала' : (mailing.botLink || 'Не указана');

        const message =
            `<b>📨 НОВАЯ ЗАЯВКА НА РАССЫЛКУ</b>\n\n` +
            `<b>👤 Пользователь:</b> #${mailing.userId}\n` +
            `<b>🎯 Тип цели:</b> ${targetType}\n` +
            `<b>🆔 ID ${targetType.toLowerCase()}а:</b> <code>${targetId}</code>\n` +
            (mailing.isChannel ? '' : `<b>🔗 Ссылка на бота:</b> ${targetLink}\n`) +
            `<b>📅 Дата создания:</b> ${new Date().toLocaleString('ru-RU')}\n` +
            `<b>📊 Статус:</b> ${statusEmoji} ${mailing.status}\n\n` +
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
            `<b>👤 Пользователь:</b> #${botSeller.userId}\n` +
            `<b>📅 Дата создания:</b> ${new Date(botSeller.createdAt).toLocaleString('ru-RU')}\n\n` +
            `<b>📝 Информация о боте:</b>\n` +
            `• <b>Описание:</b> ${botSeller.description || '<i>Не указано</i>'}\n` +
            `• <b>Статус:</b> ${statusEmoji} ${botSeller.acceptStatus}\n` +
            `• <b>Категория:</b> ${categoryEmoji} ${getCategoryName(botSeller.category)}\n\n` +
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

        console.log('Application callback handlers setup completed');
    }

    private async handleConfirmMailing(ctx: Context) {
        try {
            const mailingId = this.extractMailingId(ctx);
            console.log(`Confirming mailing application: ${mailingId}`);

            // Update the mailing status in the database
            try {
                await this.mailingService.updateMailingStatus(Number(mailingId), 'APPROVED');
                const mailing = await this.mailingService.getMailingById(Number(mailingId));
                if (!mailing) {
                    throw new HttpException(`Mailing with ID ${mailingId} not found`, HttpStatus.NOT_FOUND);
                }
                console.log(`Mailing ${mailingId} status updated to APPROVED`);
            } catch (error) {
                console.error(`Error updating mailing status in database: ${error.message}`);
                await ctx.answerCbQuery(`Ошибка обновления статуса в базе данных: ${error.message}`);
                return false;
            }

            await ctx.answerCbQuery(`✅ Заявка на рассылку #${mailingId} подтверждена`);

            const message =
                `<b>✅ ЗАЯВКА НА РАССЫЛКУ ПОДТВЕРЖДЕНА</b>\n\n` +
                `<b>🆔 ID заявки:</b> #${mailingId}\n` +
                `<b>🕒 Время обработки:</b> ${new Date().toLocaleString('ru-RU')}\n\n` +
                `<i>Рассылка была одобрена и будет отправлена пользователям.</i>`;

            await ctx.editMessageText(message, {
                reply_markup: undefined,
                parse_mode: 'HTML'
            });

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

            // Update the mailing status in the database
            try {
                await this.mailingService.updateMailingStatus(Number(mailingId), 'REJECTED');
                console.log(`Mailing ${mailingId} status updated to REJECTED`);
            } catch (error) {
                console.error(`Error updating mailing status in database: ${error.message}`);
                await ctx.answerCbQuery(`Ошибка обновления статуса в базе данных: ${error.message}`);
                return false;
            }

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

            // Update the mailing status in the database
            try {
                await this.mailingService.updateMailingStatus(Number(mailingId), 'WAITING');
                console.log(`Mailing ${mailingId} status updated to WAITING`);
            } catch (error) {
                console.error(`Error updating mailing status in database: ${error.message}`);
                await ctx.answerCbQuery(`Ошибка обновления статуса в базе данных: ${error.message}`);
                return false;
            }

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
}
