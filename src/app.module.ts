import { PrismaModule } from 'prisma/prisma.module';

import { MailingModule } from './modules/mailing/mailing.module';
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TelegramModule } from './modules/telegram/telegram.module';
import { ConfigModule } from '@nestjs/config';
import { BotSellersModule } from './modules/bot_sellers/bot-sellers.module';
import { UsersModule } from './modules/users';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true
    }),
    PrismaModule,
    MailingModule,
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 5,
    }),
    PrismaModule,
    UsersModule,
    TelegramModule,
    BotSellersModule,
  ],
  controllers: [
  ],
  providers: [
  ],
})
export class AppModule { }
