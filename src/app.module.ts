import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TelegramModule } from './modules/telegram/telegram.module';
import { BotSellersModule } from './modules/bot_sellers/bot-sellers.module';
import { PrismaModule } from './modules/prisma';
import { UsersModule } from './modules/users';

@Module({
  imports: [
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 5,
    }),
    PrismaModule,
    UsersModule,
    TelegramModule,
    BotSellersModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
