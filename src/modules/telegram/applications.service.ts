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
import { ApplicationHandlersService } from './application-handlers.service';

@Injectable()
export class ApplicationsService {
    private botSellersService: BotSellersService;

    constructor(
        private configService: ConfigService,
        @Inject(forwardRef(() => MailingService))
        private readonly applicationHandlersService: ApplicationHandlersService,
        @Inject(forwardRef(() => ProcessorService))
        @InjectBot() private readonly bot: Telegraf<Context>
    ) { }

    // This method will be called after all providers are resolved
    setBotSellersService(botSellersService: BotSellersService) {
        this.botSellersService = botSellersService;
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

    async setupCallbackHandlers() {
        // Удаляем предыдущие обработчики чтобы избежать дублирования
        this.bot.telegram.deleteMyCommands();

        // Регистрируем обработчики с правильным форматом
        this.bot.action(/confirm_mailing_application:(\d+)/, (ctx) => this.applicationHandlersService.handleConfirmMailing(ctx));
        this.bot.action(/reject_mailing_application:(\d+)/, (ctx) => this.applicationHandlersService.handleRejectMailing(ctx));
        this.bot.action(/wait_mailing_application:(\d+)/, (ctx) => this.applicationHandlersService.handleWaitMailing(ctx));

        // Add handlers for bot seller applications
        this.bot.action(/confirm_bot_seller_application:(\d+)/, (ctx) => this.applicationHandlersService.handleConfirmBotSeller(ctx));
        this.bot.action(/reject_bot_seller_application:(\d+)/, (ctx) => this.applicationHandlersService.handleRejectBotSeller(ctx));
        this.bot.action(/wait_bot_seller_application:(\d+)/, (ctx) => this.applicationHandlersService.handleWaitBotSeller(ctx));

        // Обработчик выбора категории
        this.bot.action(/select_category:(\d+)/, (ctx) => this.applicationHandlersService.handleCategorySelection(ctx));

        // Обработчики установки категории
        this.bot.action(/set_category:(\d+):(.+)/, (ctx) => this.applicationHandlersService.handleSetCategory(ctx));

        // Обработчик кнопки "Назад"
        this.bot.action(/back_to_application:(\d+)/, (ctx) => this.applicationHandlersService.handleBackToApplication(ctx));

        // NEW: Add handlers for mailing execution notification buttons
        this.bot.action(/view_post:(\d+)/, (ctx) => this.applicationHandlersService.handleViewPost(ctx));
        this.bot.action(/approve_mailing_process:(\d+)/, (ctx) => this.applicationHandlersService.handleApproveMailingProcess(ctx));
        this.bot.action(/freeze_mailing_process:(\d+)/, (ctx) => this.applicationHandlersService.handleFreezeMailingProcess(ctx));
        this.bot.action(/stats:(\d+)/, (ctx) => this.applicationHandlersService.handleGetStatistics(ctx));

        // NEW: Confirmation handlers
        this.bot.action(/confirm_approve:(\d+)/, (ctx) => this.applicationHandlersService.handleConfirmApprove(ctx));
        this.bot.action(/confirm_freeze:(\d+)/, (ctx) => this.applicationHandlersService.handleConfirmFreeze(ctx));
        this.bot.action(/cancel_action:(\d+)/, (ctx) => this.applicationHandlersService.handleCancelAction(ctx));

        console.log('Application callback handlers setup completed');
    }

    
}
