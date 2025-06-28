import { Controller, Post, Param, Body, Logger, LoggerService } from '@nestjs/common';
import { BotSellersService } from '../bot_sellers';
import { TelegramService } from './telegram.service';
import { link } from 'fs';
import { ReservationService } from '../mailing/services/reservation.service';

@Controller('telegram')
export class TelegramController {
    constructor(private readonly botSellerService: BotSellersService, private readonly telegramService: TelegramService, private readonly reservationService: ReservationService) {}
    private readonly logger = new Logger(TelegramController.name);

    @Post('webhook')
    async handleWebhook(@Body() update: any) {
        this.logger.log(`Received update: ${JSON.stringify(update)}`, 'TelegramController');
        if(update.chat_join_request) {
            this.logger.log(`Received chat join request from ${update.chat_join_request.from.id}`, 'TelegramController');
            const chatId = update.chat_join_request.chat.id;
            const userId = update.chat_join_request.from.id;
            const inviteLink = update.chat_join_request.invite_link;

            this.logger.log(`Chat ID: ${chatId}, User ID: ${userId}, Invite Link: ${inviteLink}`, 'TelegramController');
            try {
                const reservation = await this.reservationService.getMailingReservationByLink(inviteLink);
                // Approve the chat join request
                await this.telegramService.approveChatJoinRequest(chatId, userId, reservation?.mailing.botToken || '');
                await this.botSellerService.handleMailingEntrance(inviteLink, userId);
                this.logger.log(`Approved join request for user ${userId} in chat ${chatId}`, 'TelegramController');
            } catch (error) {
                this.logger.error(`Failed to approve join request for user ${userId} in chat ${chatId}: ${error.message}`, 'TelegramController');
            }


        }
    }
}