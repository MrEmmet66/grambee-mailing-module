import { Module, forwardRef } from '@nestjs/common';
import { BotSellersService } from './bot-sellers.service';
import { BotSellersController } from './bot-sellers.controller';
import { PrismaModule } from 'prisma/prisma.module';
import { TelegramModule } from '../telegram/telegram.module';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';

const uploadDir = join(process.cwd(), 'uploads/bot_users');
if (!existsSync(uploadDir)) {
  mkdirSync(uploadDir, { recursive: true });
}

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => TelegramModule),
    ConfigModule,
    HttpModule,
  ],
  controllers: [BotSellersController],
  providers: [BotSellersService],
  exports: [BotSellersService],
})
export class BotSellersModule {} 