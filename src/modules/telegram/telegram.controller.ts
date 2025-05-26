import { Controller, Post, Param, Body, Logger, LoggerService } from '@nestjs/common';

@Controller('telegram')
export class TelegramController {
    constructor() {}

    @Post('webhook')
    async handleWebhook(@Body() update: any) {
        if(update.chat_join_request) {
            Logger.log(`Received chat join request from ${update.chat_join_request.from.id}`, 'TelegramController');
            const chatId = update.chat_join_request.chat.id;
            const userId = update.chat_join_request.from.id;
            const inviteName = update.chat_join_request.from.first_name || 'Unknown';

            Logger.log(`Chat ID: ${chatId}, User ID: ${userId}, Invite Name: ${inviteName}`, 'TelegramController');
        }
    }
}