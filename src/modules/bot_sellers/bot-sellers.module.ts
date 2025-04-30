import { Module, forwardRef } from '@nestjs/common';
import { BotSellersService } from './bot-sellers.service';
import { BotSellersController } from './bot-sellers.controller';
import { PrismaModule } from 'prisma/prisma.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => TelegramModule),
  ],
  controllers: [BotSellersController],
  providers: [BotSellersService],
  exports: [BotSellersService],
})
export class BotSellersModule {} 