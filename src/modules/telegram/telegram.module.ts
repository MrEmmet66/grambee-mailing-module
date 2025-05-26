import { Module, forwardRef, OnModuleInit } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { BotSellersModule } from '../bot_sellers/bot-sellers.module';
import { BotSellersService } from '../bot_sellers/bot-sellers.service';
import { ModuleRef } from '@nestjs/core';
import { MailingService } from '../mailing/services/mailing.service';
import { MailingModule } from '../mailing/mailing.module';
import { ApplicationsService } from './applications.service';
import { MailingPaymentService } from '../mailing/services/payment.service';
import { StatsService } from '../mailing/stats/stats.service';
import { PrismaModule } from 'prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    HttpModule,
    ConfigModule,
    forwardRef(() => BotSellersModule),
    forwardRef(() => MailingModule),
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const token = configService.get<string>('BOT_TOKEN');
        if (!token) {
          throw new Error('TELEGRAM_BOT_TOKEN is not defined in environment variables');
        }
        return { token };
      },
      inject: [ConfigService],
    })
  ],
  controllers: [TelegramController],
  providers: [TelegramService, ApplicationsService, StatsService],
  exports: [TelegramService, ApplicationsService],
})
export class TelegramModule implements OnModuleInit {
  constructor(
    private moduleRef: ModuleRef,
    private telegramService: ApplicationsService
  ) {}

  async onModuleInit() {
    // Настраиваем обработчики колбэков
    await this.telegramService.setupCallbackHandlers();
    console.log('Telegram callbacks initialized');
    
    // Wait for next tick to ensure all providers are resolved
    setTimeout(() => {
      try {
        const botSellersService = this.moduleRef.get(BotSellersService, { strict: false });
        if (botSellersService) {
          this.telegramService.setBotSellersService(botSellersService);

          console.log('Bot sellers service connected to telegram service');
        }
      } catch (error) {
        console.error('Could not resolve BotSellersService:', error);
      }
    }, 0);
  }
}