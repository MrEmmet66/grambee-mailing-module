import { Module } from '@nestjs/common';
import { BotSellersService } from './bot-sellers.service';
import { BotSellersController } from './bot-sellers.controller';

@Module({
  controllers: [BotSellersController],
  providers: [BotSellersService],
  exports: [BotSellersService],
})
export class BotSellersModule {} 