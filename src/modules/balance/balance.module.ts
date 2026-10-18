import { Module } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    HttpModule
  ],
  controllers: [],
  providers: [BalanceService],
  exports: [BalanceService]
})
export class BalanceModule {} 