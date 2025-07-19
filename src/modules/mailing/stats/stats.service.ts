import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "prisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import {
    BotStatistics,
    ChannelStatistics,
    PeriodStatistics,
    UserMailingStatistics,
    SellerStatistics,
    SellerPeriodStatistics,
    MonthlyUserStatistics,
    MonthlySellerStatistics
} from "./stats.types";
import { ProcessorService } from "../services/processor.service";

@Injectable()
export class StatsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly configService: ConfigService,
        private readonly processorService: ProcessorService
    ) { } private sumViewCount(reservations: any[]): number {
        return reservations.reduce((sum, r) => sum + (r.viewCount || 0), 0);
    }

    private calculateReservationEarningsSync(reservation: any): number {
        const botSeller = reservation.botSeller;
        if (botSeller.fixedPrice) return botSeller.fixedPrice;
        if (botSeller.subscriberPrice) return (reservation.viewCount || 0) * botSeller.subscriberPrice;
        return 0;
    }

    private periodStatsPeriod(reservations: any[], fromDate?: Date) {
        let filtered = reservations;
        if (fromDate) filtered = reservations.filter(r => new Date(r.processedAt || r.date) >= fromDate);
        return {
            audienceAttracted: this.sumViewCount(filtered),
            mailingsPurchased: filtered.length,
            moneySpent: filtered.reduce((sum, r) => sum + this.calculateReservationEarningsSync(r), 0)
        };
    }
    private periodStatsSeller(reservations: any[], fromDate?: Date) {
        let filtered = reservations;
        if (fromDate) filtered = reservations.filter(r => new Date(r.processedAt || r.date) >= fromDate);
        return {
            audienceProvided: this.sumViewCount(filtered),
            mailingsSold: filtered.length,
            moneyEarned: filtered.reduce((sum, r) => sum + this.calculateReservationEarningsSync(r), 0)
        };
    }

    async getBotStatisticsById(botId: number): Promise<SellerStatistics> {
        const botSeller = await this.prisma.botSeller.findUnique({ where: { id: botId } });
        if (!botSeller) throw new NotFoundException(`Bot seller with id ${botId} not found`);
        const now = new Date();
        const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const reservations = await this.prisma.mailingReservation.findMany({
            where: { botSellerId: botId, adminApprovalStatus: 'APPROVED' },
            include: { mailing: true, botSeller: true },
            orderBy: { processedAt: 'asc' }
        });
        const totalMoneyEarned = reservations.reduce((sum, r) => sum + this.calculateReservationEarningsSync(r), 0);
        const totalMailingsSold = reservations.length;
        const totalAudienceProvided = this.sumViewCount(reservations);
        let firstDate = reservations[0]?.processedAt;
        if (!firstDate && reservations.length > 0) firstDate = reservations[0].date;
        const averageDailyEarnings = this.calculateAverageDailyEarnings(totalMoneyEarned, firstDate, now);
        const sellerStats = reservations.map(reservation => ({
            link: reservation.trackingLink || reservation.mailing.link,
            audienceProvided: reservation.viewCount || 0,
            moneyEarned: this.calculateReservationEarningsSync(reservation)
        }));
        return {
            totalMoneyEarned,
            totalMailingsSold,
            averageDailyEarnings,
            totalAudienceProvided,
            periods: {
                day: this.periodStatsSeller(reservations, dayAgo),
                week: this.periodStatsSeller(reservations, weekAgo),
                allTime: this.periodStatsSeller(reservations)
            },
            sellers: sellerStats
        };
    }

    async getUserMailingStatistics(userId: number): Promise<UserMailingStatistics> {
        const now = new Date();
        const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const reservations = await this.prisma.mailingReservation.findMany({
            where: { mailing: { userId: userId }, adminApprovalStatus: 'APPROVED' },
            include: { mailing: true, botSeller: true },
            orderBy: { processedAt: 'asc' }
        });
        const totalAudienceAttracted = this.sumViewCount(reservations);
        const totalMailingsPurchased = reservations.length;
        const totalMoneySpent = reservations.reduce((sum, r) => sum + this.calculateReservationEarningsSync(r), 0);
        const firstReservationDate = reservations[0]?.processedAt || reservations[0]?.date;
        // Fix: calculate average daily volume (audience attracted per day)
        let averageDailyVolume = 0;
        if (firstReservationDate && totalAudienceAttracted > 0) {
            const daysDifference = Math.max(1, Math.ceil((now.getTime() - new Date(firstReservationDate).getTime()) / (24 * 60 * 60 * 1000)));
            averageDailyVolume = parseFloat((totalAudienceAttracted / daysDifference).toFixed(2));
        }
        const mailingStats = reservations.map(reservation => ({
            link: reservation.mailing.link || reservation.trackingLink || '',
            audienceAttracted: reservation.viewCount || 0,
            moneySpent: this.calculateReservationEarningsSync(reservation)
        }));
        return {
            totalAudienceAttracted,
            totalMailingsPurchased,
            averageDailyVolume,
            totalMoneySpent,
            periods: {
                day: this.periodStatsPeriod(reservations, dayAgo),
                week: this.periodStatsPeriod(reservations, weekAgo),
                allTime: this.periodStatsPeriod(reservations)
            },
            mailings: mailingStats
        };
    }

    async getBotStatistics(mailingReservationId: number): Promise<BotStatistics> {
        const reservation = await this.prisma.mailingReservation.findUnique({
            where: { id: mailingReservationId },
            include: { botSeller: true, mailing: true }
        });
        const queue = await this.prisma.reservationQueue.findFirst({
            where: { mailingReservationId: mailingReservationId }
        });
        if (!queue) throw new NotFoundException('Reservation queue not found');
        if (!reservation) throw new NotFoundException('Mailing reservation not found');

        return {
            totalClicks: reservation.viewCount || 0,
            uniqueClicks: reservation.viewCount || 0,
            userStats: { new: 0, dead: 0, premium: 0, rtl: 0 },
            conversionStats: { performedActions: 0, passedSponsors: 0, leftAfterStart: 0 },
            audienceAnalysis: {},
            totalSent: queue.sentCount || 0,
            totalFailed: queue.failedCount || 0,
            totalUsers: queue.totalUsers || 0,
            averageSpeed: await this.processorService.getAverageQueueSpeed(queue.queueName) || 0,
            queueStart: queue.createdAt,
            queueEnd: queue.updatedAt || new Date(),

        };
    }

    async getChannelStatistics(mailingReservationId: number): Promise<ChannelStatistics> {
        const reservation = await this.prisma.mailingReservation.findUnique({
            where: { id: mailingReservationId },
            include: { botSeller: true, mailing: true }
        });
        if (!reservation) throw new NotFoundException('Mailing reservation not found');
        const botSeller = reservation.botSeller;
        return {
            cleanSubscribers: reservation.viewCount || 0,
            subscriberTurnover: reservation.viewCount || 0,
            audienceCountries: {},
            resourceLink: reservation.trackingLink || botSeller.link
        };
    }

    async getSellerStatistics(userId: number): Promise<SellerStatistics> {
        const now = new Date();
        const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        // Get all mailing reservations for all sellers owned by this user
        const reservations = await this.prisma.mailingReservation.findMany({
            where: {
                botSeller: {
                    userId: userId
                },
                adminApprovalStatus: 'APPROVED'
            },
            include: {
                mailing: true,
                botSeller: true
            },
            orderBy: {
                processedAt: 'asc'
            }
        });

        // Calculate totals
        const totalMoneyEarned = reservations.reduce((sum, r) => sum + this.calculateReservationEarningsSync(r), 0);
        const totalMailingsSold = reservations.length;
        const totalAudienceProvided = this.sumViewCount(reservations);

        // Calculate average daily earnings - use the earliest processedAt or date
        let firstDate = reservations[0]?.processedAt;
        if (!firstDate && reservations.length > 0) {
            firstDate = reservations[0].date;
        }

        const averageDailyEarnings = this.calculateAverageDailyEarnings(
            totalMoneyEarned,
            firstDate,
            now
        );
        const sellerStats = reservations.map(reservation => ({
            link: reservation.botSeller.link || '',
            audienceProvided: reservation.viewCount || 0,
            moneyEarned: this.calculateReservationEarningsSync(reservation),
        }));

        return {
            totalMoneyEarned,
            totalMailingsSold,
            averageDailyEarnings,
            totalAudienceProvided,
            periods: {
                day: this.periodStatsSeller(reservations, dayAgo),
                week: this.periodStatsSeller(reservations, weekAgo),
                allTime: this.periodStatsSeller(reservations)
            },
            sellers: sellerStats
        };
    }

    // Remove duplicate periodStatsSeller implementation (keep only one)

    // Remove unused legacy helpers: calculateClickStatistics, calculateUserStatistics, calculateConversionStatistics, analyzeAudienceByCountry, analyzeChannelAudience if not referenced elsewhere

    private calculateAverageDailyEarnings(totalEarnings: number, startDate: Date | null, endDate: Date): number {
        if (!startDate || totalEarnings === 0) return 0;

        const daysDifference = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)));
        return parseFloat((totalEarnings / daysDifference).toFixed(2));
    }

    async formatBotStatistics(stats: BotStatistics, reservationId: number): Promise<string> {
        const total = stats.totalClicks;
        const estimatedDateTime = stats.queueEnd ? new Date(stats.queueEnd.getTime() + (stats.totalUsers / stats.averageSpeed) * 1000).toLocaleString() : 'N/A';

        // Получаем базовую статистику по памяти и CPU
        const mem = process.memoryUsage();
        const cpu = process.cpuUsage();
        const memMb = (mem.rss / 1024 / 1024).toFixed(2);
        const heapUsedMb = (mem.heapUsed / 1024 / 1024).toFixed(2);
        const heapTotalMb = (mem.heapTotal / 1024 / 1024).toFixed(2);
        const cpuUserMs = (cpu.user / 1000).toFixed(0);
        const cpuSystemMs = (cpu.system / 1000).toFixed(0);
        const queueName = `mailing_${reservationId || ''}`;
        const floodWaitHistory = this.processorService?.getQueueFloodwaitHistory(queueName) || [];

        // Метрики очереди и Redis
        let queueStats = '';
        try {
            // Получаем имя очереди (по соглашению)
            

            // Получаем очередь через ProcessorService (если реализовано)
            const queue = this.processorService?.getQueueByName(queueName);

            if (queue) {
                const counts = await queue.getJobCounts();
                queueStats += `\nОчередь: ${queueName}`;
                queueStats += `\n  waiting: ${counts.waiting}`;
                queueStats += `\n  active: ${counts.active}`;
                queueStats += `\n  completed: ${counts.completed}`;
                queueStats += `\n  failed: ${counts.failed}`;
                queueStats += `\n  delayed: ${counts.delayed}`;
                // Redis info
                const redisInfo = await queue.client.info();
                // Парсим used_memory и connected_clients
                const usedMemory = redisInfo.match(/used_memory:(\d+)/)?.[1];
                const connectedClients = redisInfo.match(/connected_clients:(\d+)/)?.[1];
                if (usedMemory && connectedClients) {
                    queueStats += `\nRedis: used_memory: ${(Number(usedMemory)/1024/1024).toFixed(2)} MB, connected_clients: ${connectedClients}`;
                }
            } else {
                queueStats += '\nОчередь завершена или неактивна';
            }
        } catch (err) {
            queueStats += `\n(Не удалось получить метрики очереди/Redis)`;
        }

        return `
🤖 Статистика бота

Всего переходов: ${stats.totalClicks}
└Уникальных: ${stats.uniqueClicks}

👥 Статистика пользователей
├Новых: ${stats.userStats.new} (${this.getPercentage(stats.userStats.new, total)})
├Мертвых: ${stats.userStats.dead} (${this.getPercentage(stats.userStats.dead, total)})
├Премиум: ${stats.userStats.premium} (${this.getPercentage(stats.userStats.premium, total)})
└RTL: ${stats.userStats.rtl} (${this.getPercentage(stats.userStats.rtl, total)})

🚪 Статистика проходимости
├Выполнили действие: ${stats.conversionStats.performedActions} (${this.getPercentage(stats.conversionStats.performedActions, total)})
├Прошли спонсоров: ${stats.conversionStats.passedSponsors} (${this.getPercentage(stats.conversionStats.passedSponsors, total)})
└Ушли после старта: ${stats.conversionStats.leftAfterStart} (${this.getPercentage(stats.conversionStats.leftAfterStart, total)})

✉️Статистика рассылки:
Всего пользователей: ${stats.totalUsers}
Всего отправлено: ${stats.totalSent}
Всего неудачно: ${stats.totalFailed}
⏱️ Средняя скорость рассылки: ${stats.averageSpeed.toFixed(2)} сообщений/сек
⏱️ Заданная Скорость рассылки: ${this.processorService.getQueueCurrentSpeed(queueName).toFixed(2)} сообщений/сек
⏱️ Сообщений за 5 секунд: ${this.processorService.getQueueActualSpeed(queueName).toFixed(2)} сообщений/5 сек

🕒 Время начала очереди: ${stats.queueStart.toString()}
🕔 Время окончания очереди: ${stats.queueEnd.toString()}
🕓 Оценочное время завершения: ${estimatedDateTime.toString()}

📊 Использование ресурсов сервера:
Память RSS: ${memMb} MB
Heap Used: ${heapUsedMb} MB / ${heapTotalMb} MB
CPU: user ${cpuUserMs} ms, system ${cpuSystemMs} ms

${queueStats}

📈 FLOOD_WAIT история:
${floodWaitHistory.map(event => `- ${new Date(event.timestamp).toLocaleString()}: ${event.retryAfter} сек`).join('\n')}

        `
    }

    async formatChannelStatistics(stats: ChannelStatistics): Promise<string> {
        return `
📺 Статистика канала

Чистые пдп: ${stats.cleanSubscribers}
Оборот пдп: ${stats.subscriberTurnover}


Ссылка на ресурс: ${stats.resourceLink}
        `.trim();
    }


    private getPercentage(value: number, total: number): string {
        if (total === 0) return '0.00%';
        return ((value / total) * 100).toFixed(2) + '%';
    }

    async getMailingReservationDetails(mailingReservationId: number) {
        return await this.prisma.mailingReservation.findUnique({
            where: { id: mailingReservationId },
            include: {
                botSeller: {
                    include: {
                        user: true
                    }
                },
                mailing: {
                    include: {
                        user: true
                    }
                }
            }
        });
    }

    async approveMailingReservation(mailingReservationId: number) {
        const reservation = await this.prisma.mailingReservation.findUnique({
            where: { id: mailingReservationId }
        }); if (!reservation) {
            throw new NotFoundException('Mailing reservation not found');
        }

        // Transfer money from held amount to paid amount
        await this.prisma.mailingReservation.update({
            where: { id: mailingReservationId },
            data: {
                paidAmount: reservation.heldAmount,
                adminApprovalStatus: 'APPROVED',
                processedAt: new Date(),
                isProcessed: true
            }
        });

        return { success: true, message: 'Mailing approved and payment processed' };
    }

    async freezeMailingReservation(mailingReservationId: number) {
        await this.prisma.mailingReservation.update({
            where: { id: mailingReservationId },
            data: {
                adminApprovalStatus: 'FROZEN'
            }
        });

        return { success: true, message: 'Mailing frozen for review' };
    }

    async getUserMonthlyStatistics(userId: number, months: number): Promise<MonthlyUserStatistics[]> {
        const now = new Date();
        const startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

        // Get all mailing reservations for user's mailings within the period
        const reservations = await this.prisma.mailingReservation.findMany({
            where: {
                mailing: {
                    userId: userId
                },
                adminApprovalStatus: 'APPROVED',
                date: {
                    gte: startDate
                }
            },
            include: {
                mailing: true,
                botSeller: true,
            }
        });

        return await this.groupUserReservationsByMonth(reservations, months);
    }

    async getSellerMonthlyStatistics(userId: number, months: number): Promise<MonthlySellerStatistics[]> {
        const now = new Date();
        const startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

        // Get all mailing reservations for all sellers owned by this user within the period
        const reservations = await this.prisma.mailingReservation.findMany({
            where: {
                botSeller: {
                    userId: userId,
                },
                date: {
                    gte: startDate
                },
                adminApprovalStatus: 'APPROVED',
            },
            include: {
                mailing: true,
                botSeller: true,
            }
        });

        return await this.groupSellerReservationsByMonth(reservations, months);
    }

    async getBotMonthlyStatistics(botId: number, months: number = 5): Promise<MonthlySellerStatistics[]> {
        const now = new Date();
        const startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

        // Get all mailing reservations for all sellers owned by this user within the period
        const reservations = await this.prisma.mailingReservation.findMany({
            where: {
                botSeller: {
                    id: botId
                },
                adminApprovalStatus: 'APPROVED',
                date: {
                    gte: startDate
                }
            },
            include: {
                mailing: true,
                botSeller: true,
            }
        });

        return await this.groupSellerReservationsByMonth(reservations, months);
    }


    private async groupUserReservationsByMonth(reservations: any[], months: number): Promise<MonthlyUserStatistics[]> {
        const now = new Date();
        const monthlyData = new Map<string, any>();
        for (let i = months - 1; i >= 0; i--) {
            const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            monthlyData.set(monthKey, {
                month: monthKey,
                audienceAttracted: 0,
                moneySpent: 0,
                mailingsPurchased: 0,
                reservations: []
            });
        }
        for (const reservation of reservations) {
            const resDate = new Date(reservation.processedAt || reservation.date);
            const monthKey = `${resDate.getFullYear()}-${String(resDate.getMonth() + 1).padStart(2, '0')}`;
            if (monthlyData.has(monthKey)) {
                const monthData = monthlyData.get(monthKey);
                monthData.reservations.push(reservation);
            }
        }
        const results: MonthlyUserStatistics[] = [];
        for (const [monthKey, monthData] of monthlyData) {
            if (monthData.reservations.length > 0) {
                monthData.audienceAttracted = this.sumViewCount(monthData.reservations);
                monthData.mailingsPurchased = monthData.reservations.length;
                monthData.moneySpent = monthData.reservations.reduce((sum, r) => sum + this.calculateReservationEarningsSync(r), 0);
            }
            delete monthData.reservations;
            results.push(monthData);
        }
        return results;
    }

    private async groupSellerReservationsByMonth(reservations: any[], months: number): Promise<MonthlySellerStatistics[]> {
        const now = new Date();
        const monthlyData = new Map<string, any>();
        for (let i = months - 1; i >= 0; i--) {
            const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            monthlyData.set(monthKey, {
                month: monthKey,
                audienceProvided: 0,
                moneyEarned: 0,
                mailingsSold: 0,
                reservations: []
            });
        }
        for (const reservation of reservations) {
            const resDate = new Date(reservation.processedAt || reservation.date);
            const monthKey = `${resDate.getFullYear()}-${String(resDate.getMonth() + 1).padStart(2, '0')}`;
            if (monthlyData.has(monthKey)) {
                const monthData = monthlyData.get(monthKey);
                monthData.reservations.push(reservation);
            }
        }
        const results: MonthlySellerStatistics[] = [];
        for (const [monthKey, monthData] of monthlyData) {
            if (monthData.reservations.length > 0) {
                monthData.audienceProvided = this.sumViewCount(monthData.reservations);
                monthData.mailingsSold = monthData.reservations.length;
                monthData.moneyEarned = monthData.reservations.reduce((sum, r) => sum + this.calculateReservationEarningsSync(r), 0);
            }
            delete monthData.reservations;
            results.push(monthData);
        }
        return results;
    }
}
