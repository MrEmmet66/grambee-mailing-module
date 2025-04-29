import { Module } from '@nestjs/common';
import { BotSellersService } from './bot-sellers.service';
import { BotSellersController } from './bot-sellers.controller';
import { PrismaModule } from 'prisma/prisma.module';

@Module({
  imports: [PrismaModule],
controllers: [BotSellersController],
  providers: [BotSellersService],
  exports: [BotSellersService],
})
export class BotSellersModule {} 