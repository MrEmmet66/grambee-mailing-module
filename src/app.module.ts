import { PrismaModule } from '../prisma/prisma.module';
import { PUBLIC_UPLOAD_OPTIONS } from './config/public-uploads';
import { validateEnvironment } from './config/validate-environment';
import { CommissionsModule } from './modules/commissions/commissions.module';
import { HealthController } from './modules/health.controller';

import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AuthModule } from './modules/auth/auth.module';
import { BalanceModule } from './modules/balance/balance.module';
import { BotSellersModule } from './modules/bot_sellers/bot-sellers.module';
import { MailingModule } from './modules/mailing/mailing.module';
import { StatsModule } from './modules/mailing/stats/stats.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    CommissionsModule,
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: `${process.cwd()}/uploads`,
      serveRoot: '/api/v1/uploads',
      serveStaticOptions: PUBLIC_UPLOAD_OPTIONS,
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
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
    AuthModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
