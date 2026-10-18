import { CommissionsModule } from './modules/commissions/commissions.module';
import { HealthController } from './modules/health.controller';
import { MailingCheckoutService } from './modules/mailing/services/mailingcheckout.service';
import { PrismaModule } from 'prisma/prisma.module';

import { MailingModule } from './modules/mailing/mailing.module';
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TelegramModule } from './modules/telegram/telegram.module';
import { ConfigModule } from '@nestjs/config';
import { BotSellersModule } from './modules/bot_sellers/bot-sellers.module';
import { UsersModule } from './modules/users';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ScheduleModule } from '@nestjs/schedule';
import { BalanceModule } from './modules/balance/balance.module';
import { StatsModule } from './modules/mailing/stats/stats.module';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [
    CommissionsModule,
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: `${process.cwd()}/uploads`,
      serveRoot: '/api/v1/uploads',
    }),
    ConfigModule.forRoot({
      isGlobal: true
    }),
    PrismaModule,
    MailingModule,
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 5,
    }),
    BalanceModule,
    PrismaModule,
    UsersModule,
    TelegramModule,
    BotSellersModule,
    StatsModule,
    AuthModule
  ],
  controllers: [
    HealthController,
  ],
  providers: [
  ],
})
export class AppModule { }
