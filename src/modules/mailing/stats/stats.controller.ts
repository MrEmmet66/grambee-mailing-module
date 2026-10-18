import { Owns } from '../../auth/guards/resource-owner.guard';
import { ServiceOnly } from '../../auth/decorators/auth-policy.decorator';
import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { StatsService } from './stats.service';
import {
  UserMailingStatistics,
  BotStatistics,
  ChannelStatistics,
  SellerStatistics,
  MonthlyUserStatistics,
  MonthlySellerStatistics,
} from './stats.types';
import { SecretKeyGuard } from '../../auth/guards/secretKey.guard';

@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Owns('user', 'userId')
  @Get('user/:userId/mailings')
  async getUserMailingStatistics(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<UserMailingStatistics> {
    return await this.statsService.getUserMailingStatistics(userId);
  }

  @Get('user/:userId/mailings/count')
  @ServiceOnly()
  async getUserMailingReservationsCount(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<{ count: number }> {
    const count =
      await this.statsService.getUserMailingReservationsCount(userId);
    return { count };
  }

  @Owns('user', 'userId')
  @Get('user/:userId/mailings/monthly')
  async getUserMonthlyStatistics(
    @Param('userId', ParseIntPipe) userId: number,
    @Query('months', ParseIntPipe) months: number,
  ): Promise<MonthlyUserStatistics[]> {
    return await this.statsService.getUserMonthlyStatistics(userId, months);
  }

  @Owns('user', 'userId')
  @Get('seller/:userId/mailings')
  async getSellerStatistics(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<SellerStatistics> {
    return await this.statsService.getSellerStatistics(userId);
  } // endpoint for statistics of certain bot by ID
  @Owns('bot', 'botId')
  @Get('bot/:botId')
  async getBotStatisticsById(
    @Param('botId', ParseIntPipe) botId: number,
  ): Promise<SellerStatistics> {
    return await this.statsService.getBotStatisticsById(botId);
  }

  @Owns('user', 'userId')
  @Get('seller/:userId/mailings/monthly')
  async getSellerMonthlyStatistics(
    @Param('userId', ParseIntPipe) userId: number,
    @Query('months', ParseIntPipe) months: number,
  ): Promise<MonthlySellerStatistics[]> {
    return await this.statsService.getSellerMonthlyStatistics(userId, months);
  }

  @Owns('bot', 'botId')
  @Get('bot/:botId/mailings/monthly')
  async getBotMonthlyStatistics(
    @Param('botId', ParseIntPipe) botId: number,
    @Query('months', ParseIntPipe) months: number,
  ): Promise<MonthlySellerStatistics[]> {
    return await this.statsService.getBotMonthlyStatistics(botId, months);
  }

  @Owns('reservationParticipant', 'reservationId')
  @Get('reservation/:reservationId/bot')
  async getBotStatistics(
    @Param('reservationId', ParseIntPipe) reservationId: number,
  ): Promise<{ raw: BotStatistics; formatted: string }> {
    const stats = await this.statsService.getBotStatistics(reservationId);
    const formatted = await this.statsService.formatBotStatistics(
      stats,
      reservationId,
    );

    return {
      raw: stats,
      formatted,
    };
  }

  @Owns('reservationParticipant', 'reservationId')
  @Get('reservation/:reservationId/channel')
  async getChannelStatistics(
    @Param('reservationId', ParseIntPipe) reservationId: number,
  ): Promise<{ raw: ChannelStatistics; formatted: string }> {
    const stats = await this.statsService.getChannelStatistics(reservationId);
    const formatted = await this.statsService.formatChannelStatistics(stats);

    return {
      raw: stats,
      formatted,
    };
  }

  @Owns('reservationParticipant', 'reservationId')
  @Get('reservation/:reservationId/details')
  async getMailingReservationDetails(
    @Param('reservationId', ParseIntPipe) reservationId: number,
  ) {
    return await this.statsService.getMailingReservationDetails(reservationId);
  }

  @Owns('telegramUser', 'userId')
  @Get('bots/user/:userId')
  async getSellerBotsAverageDailyViews(
    @Param('userId', ParseIntPipe) userId: number,
    @Query('isAllResources') isAllResources: boolean,
  ): Promise<{
    bots: Array<{ avg_daily_views: number; link: string; name: string }>;
    status: string;
  }> {
    return await this.statsService.getSellerBotsAverageDailyViews(
      userId,
      isAllResources,
    );
  }
}
