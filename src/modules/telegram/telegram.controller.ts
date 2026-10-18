import { Controller, Post, Param, Body, Logger, LoggerService } from '@nestjs/common';
import { BotSellersService } from '../bot_sellers/bot-sellers.service';
import { TelegramService } from './telegram.service';
import { link } from 'fs';
import { ReservationService } from '../mailing/services/reservation.service';

@Controller('telegram')
export class TelegramController {
    constructor(private readonly botSellerService: BotSellersService, private readonly telegramService: TelegramService, private readonly reservationService: ReservationService) {}
    private readonly logger = new Logger(TelegramController.name);
}