import { Controller, ForbiddenException, Get, Headers, Param, ParseIntPipe, Query } from "@nestjs/common";
import { StatsService } from "./stats.service";
import { UserMailingStatistics, BotStatistics, ChannelStatistics, SellerStatistics, MonthlyUserStatistics, MonthlySellerStatistics } from "./stats.types";

@Controller('stats')
export class StatsController {
    constructor(private readonly statsService: StatsService) {}

    @Get('user/:userId/mailings')
    async getUserMailingStatistics(@Param('userId', ParseIntPipe) userId: number): Promise<UserMailingStatistics> {
        return await this.statsService.getUserMailingStatistics(userId);
    }

    

    @Get('user/:userId/mailings/monthly')
    async getUserMonthlyStatistics(
        @Param('userId', ParseIntPipe) userId: number,
        @Query('months', ParseIntPipe) months: number
    ): Promise<MonthlyUserStatistics[]> {
        return await this.statsService.getUserMonthlyStatistics(userId, months);
    }

    @Get('seller/:userId/mailings')
    async getSellerStatistics(@Param('userId', ParseIntPipe) userId: number): Promise<SellerStatistics> {
        return await this.statsService.getSellerStatistics(userId);
    }    // endpoint for statistics of certain bot by ID
    @Get('bot/:botId')
    async getBotStatisticsById(@Param('botId', ParseIntPipe) botId: number): Promise<SellerStatistics> {
        return await this.statsService.getBotStatisticsById(botId);
    }

    @Get('seller/:userId/mailings/monthly')
    async getSellerMonthlyStatistics(
        @Param('userId', ParseIntPipe) userId: number,
        @Query('months', ParseIntPipe) months: number
    ): Promise<MonthlySellerStatistics[]> {
        return await this.statsService.getSellerMonthlyStatistics(userId, months);
    }

    @Get('bot/:botId/mailings/monthly')
    async getBotMonthlyStatistics(
        @Param('botId', ParseIntPipe) botId: number,
        @Query('months', ParseIntPipe) months: number
    ): Promise<MonthlySellerStatistics[]> {
        return await this.statsService.getBotMonthlyStatistics(botId, months);
    }

    @Get('reservation/:reservationId/bot')
    async getBotStatistics(@Param('reservationId', ParseIntPipe) reservationId: number): Promise<{ raw: BotStatistics; formatted: string }> {
        const stats = await this.statsService.getBotStatistics(reservationId);
        const formatted = await this.statsService.formatBotStatistics(stats, reservationId);
        
        return {
            raw: stats,
            formatted
        };
    }

    @Get('reservation/:reservationId/channel')
    async getChannelStatistics(@Param('reservationId', ParseIntPipe) reservationId: number): Promise<{ raw: ChannelStatistics; formatted: string }> {
        const stats = await this.statsService.getChannelStatistics(reservationId);
        const formatted = await this.statsService.formatChannelStatistics(stats);
        
        return {
            raw: stats,
            formatted
        };
    }

    @Get('reservation/:reservationId/details')
    async getMailingReservationDetails(@Param('reservationId', ParseIntPipe) reservationId: number) {
        return await this.statsService.getMailingReservationDetails(reservationId);
    }

    @Get('bots/user/:userId')
    async getSellerBotsAverageDailyViews(@Param('userId', ParseIntPipe) userId: number, @Query('isAllResources') isAllResources: boolean): Promise<{ bots: Array<{ avg_daily_views: number; link: string; name: string }>; status: string }> {
        return await this.statsService.getSellerBotsAverageDailyViews(userId, isAllResources);
    }

}