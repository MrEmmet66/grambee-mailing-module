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

@Injectable()
export class StatsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly configService: ConfigService
    ) {}    async getBotStatisticsById(botId: number): Promise<SellerStatistics> {
        // Проверяем существование бота
        const botSeller = await this.prisma.botSeller.findUnique({
            where: { id: botId }
        });

        if (!botSeller) {
            throw new NotFoundException(`Bot seller with id ${botId} not found`);
        }

        const now = new Date();
        const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        // Получаем все резервации для этого бота
        const reservations = await this.prisma.mailingReservation.findMany({
            where: {
                botSellerId: botId,
                adminApprovalStatus: 'APPROVED'
            },
            include: {
                mailing: true,
                botSeller: true,
                MailingEntrances: true
            },
            orderBy: {
                processedAt: 'asc'
            }
        });

        // Вычисляем основную статистику
        const totalMoneyEarned = await this.calculateTotalMoneyEarned(reservations);
        const totalMailingsSold = reservations.length;
        const totalAudienceProvided = this.calculateUniqueAudienceFromReservations(reservations);

        // Вычисляем средний дневной доход - используем самую раннюю дату входа если processedAt нет
        let firstDate = reservations[0]?.processedAt;
        if (!firstDate && reservations.length > 0) {
            const allEntrances = reservations.flatMap(r => r.MailingEntrances);
            if (allEntrances.length > 0) {
                firstDate = new Date(Math.min(...allEntrances.map(e => new Date(e.date).getTime())));
            }
        }

        const averageDailyEarnings = this.calculateAverageDailyEarnings(
            totalMoneyEarned,
            firstDate,
            now
        );

        const sellerStats = await Promise.all(
            reservations.map(async (reservation) => ({
                link: reservation.trackingLink || reservation.botSeller.link,
                audienceProvided: reservation.MailingEntrances ? 
                    new Set(reservation.MailingEntrances.map(e => e.userTelegramId)).size : 0,
                moneyEarned: await this.calculateReservationEarnings(reservation)
            }))
        );

        return {
            totalMoneyEarned,
            totalMailingsSold,
            averageDailyEarnings,
            totalAudienceProvided,
            periods: {
                day: await this.calculateSellerPeriodStatisticsByEntranceDate(reservations, dayAgo),
                week: await this.calculateSellerPeriodStatisticsByEntranceDate(reservations, weekAgo),
                allTime: await this.calculateSellerPeriodStatistics(reservations)
            },
            sellers: sellerStats
        };
    }

    private async calculateReservationEarnings(reservation: any): Promise<number> {
        const botSeller = reservation.botSeller;
        
        if (botSeller.fixedPrice) {
            return botSeller.fixedPrice;
        } else if (botSeller.subscriberPrice) {
            const uniqueUsers = reservation.MailingEntrances ? 
                new Set(reservation.MailingEntrances.map(e => e.userTelegramId)).size : 0;
            return botSeller.subscriberPrice * uniqueUsers;
        }
        
        return 0;
    }

    async getUserMailingStatistics(userId: number): Promise<UserMailingStatistics> {
        const now = new Date();
        const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        // Get all mailing reservations for user's mailings
        const reservations = await this.prisma.mailingReservation.findMany({
            where: {
                mailing: {
                    userId: userId
                },
                adminApprovalStatus: 'APPROVED'
            },
            include: {
                mailing: true,
                botSeller: true,
                MailingEntrances: true
            },
            orderBy: {
                processedAt: 'asc'
            }
        });

        // Calculate totals using unique entrances
        const totalAudienceAttracted = this.calculateUniqueAudienceFromReservations(reservations);
        const totalMailingsPurchased = reservations.length;
        const totalMoneySpent = await this.calculateTotalMoneySpent(reservations);

        // Calculate average daily volume
        const firstReservationDate = reservations[0]?.processedAt;
        const averageDailyVolume = this.calculateAverageDailyVolume(
            totalAudienceAttracted,
            firstReservationDate,
            now
        );

        const mailingStats = await Promise.all(
            reservations.map(async (reservation) => {
                return {
                    link: reservation.mailing.botLink || reservation.trackingLink || '',
                    audienceAttracted: this.calculateUniqueAudienceFromReservations([reservation]),
                    moneySpent: await this.calculateTotalMoneySpent([reservation]),
                };
            })
        );

        return {
            totalAudienceAttracted,
            totalMailingsPurchased,
            averageDailyVolume,
            totalMoneySpent,
            periods: {
                day: await this.calculatePeriodStatisticsByEntranceDate(reservations, dayAgo),
                week: await this.calculatePeriodStatisticsByEntranceDate(reservations, weekAgo),
                allTime: await this.calculatePeriodStatistics(reservations)
            },
            mailings: mailingStats
        };
    }

    private async calculatePeriodStatisticsByEntranceDate(reservations: any[], fromDate: Date): Promise<PeriodStatistics> {
        // Filter reservations that have entrances within the period
        const reservationsWithRecentEntrances = reservations.map(reservation => ({
            ...reservation,
            MailingEntrances: reservation.MailingEntrances.filter(entrance => 
                new Date(entrance.date) >= fromDate
            )
        })).filter(reservation => reservation.MailingEntrances.length > 0);

        const audienceAttracted = this.calculateUniqueAudienceFromReservations(reservationsWithRecentEntrances);
        const mailingsPurchased = reservationsWithRecentEntrances.length;
        const moneySpent = await this.calculateTotalMoneySpentForPeriod(reservationsWithRecentEntrances);

        return {
            audienceAttracted,
            moneySpent,
            mailingsPurchased
        };
    }

    private async calculateTotalMoneySpentForPeriod(reservations: any[]): Promise<number> {
        let totalSpent = 0;

        for (const reservation of reservations) {
            const targetBot = await this.prisma.mailingTargetBots.findFirst({
                where: {
                    mailingId: reservation.mailingId,
                    botSellerId: reservation.botSellerId
                }
            });

            // Calculate unique entrances for this reservation (filtered entrances)
            const uniqueUserIds = new Set();
            if (reservation.MailingEntrances && reservation.MailingEntrances.length > 0) {
                reservation.MailingEntrances.forEach(entrance => {
                    uniqueUserIds.add(entrance.userTelegramId);
                });
            }
            const entranceCount = uniqueUserIds.size;

            if (targetBot?.paymentType === 'fixed') {
                // For fixed payment, only count if there are entrances in this period
                if (entranceCount > 0) {
                    const sellerPrice = reservation.botSeller.fixedPrice || 0;
                    const serviceCommission = this.configService.get<number>('SERVICE_COMMISSION_FIXED', 25);
                    totalSpent += sellerPrice + serviceCommission;
                }

            } else if (targetBot?.paymentType === 'subscriber') {
                // Per subscriber payment: calculate based on actual unique entrances in period
                const pricePerSubscriber = reservation.botSeller.subscriberPrice || 0;
                const serviceCommissionPerUser = this.configService.get<number>('SERVICE_COMMISSION_PER_USER', 0.03);
                
                const sellerAmount = pricePerSubscriber * entranceCount;
                const serviceCommission = serviceCommissionPerUser * entranceCount;
                totalSpent += sellerAmount + serviceCommission;

            } else {
                // Fallback to fixed price, only if there are entrances
                if (entranceCount > 0) {
                    const sellerPrice = reservation.botSeller.fixedPrice || 0;
                    const serviceCommission = this.configService.get<number>('SERVICE_COMMISSION_FIXED', 25);
                    totalSpent += sellerPrice + serviceCommission;
                }
            }
        }

        return totalSpent;
    }

    private async calculatePeriodStatistics(reservations: any[]): Promise<PeriodStatistics> {
        const audienceAttracted = this.calculateUniqueAudienceFromReservations(reservations);
        const mailingsPurchased = reservations.length;
        const moneySpent = await this.calculateTotalMoneySpent(reservations);

        return {
            audienceAttracted,
            moneySpent,
            mailingsPurchased
        };
    }

    private calculateUniqueAudienceFromReservations(reservations: any[]): number {
        let totalUniqueUsers = 0;

        // For each reservation, count unique users from MailingEntrances
        reservations.forEach(reservation => {
            const uniqueUserIds = new Set();
            
            if (reservation.MailingEntrances && reservation.MailingEntrances.length > 0) {
                reservation.MailingEntrances.forEach(entrance => {
                    uniqueUserIds.add(entrance.userTelegramId);
                });
            }
            
            totalUniqueUsers += uniqueUserIds.size;
        });

        return totalUniqueUsers;
    }

    private async calculateTotalMoneySpent(reservations: any[]): Promise<number> {
        let totalSpent = 0;

        for (const reservation of reservations) {
            const targetBot = await this.prisma.mailingTargetBots.findFirst({
                where: {
                    mailingId: reservation.mailingId,
                    botSellerId: reservation.botSellerId
                }
            });

            // Calculate unique entrances for this reservation
            const uniqueUserIds = new Set();
            if (reservation.MailingEntrances && reservation.MailingEntrances.length > 0) {
                reservation.MailingEntrances.forEach(entrance => {
                    uniqueUserIds.add(entrance.userTelegramId);
                });
            }
            const entranceCount = uniqueUserIds.size;

            if (targetBot?.paymentType === 'fixed') {
                // Fixed payment: seller price + service commission
                const sellerPrice = reservation.botSeller.fixedPrice || 0;
                const serviceCommission = this.configService.get<number>('SERVICE_COMMISSION_FIXED', 25);
                totalSpent += sellerPrice + serviceCommission;

            } else if (targetBot?.paymentType === 'subscriber') {
                // Per subscriber payment: calculate based on actual unique entrances
                const pricePerSubscriber = reservation.botSeller.subscriberPrice || 0;
                const serviceCommissionPerUser = this.configService.get<number>('SERVICE_COMMISSION_PER_USER', 0.03);
                
                const sellerAmount = pricePerSubscriber * entranceCount;
                const serviceCommission = serviceCommissionPerUser * entranceCount;
                totalSpent += sellerAmount + serviceCommission;

            } else {
                // Fallback to fixed price
                const sellerPrice = reservation.botSeller.fixedPrice || 0;
                const serviceCommission = this.configService.get<number>('SERVICE_COMMISSION_FIXED', 25);
                totalSpent += sellerPrice + serviceCommission;
            }
        }

        return totalSpent;
    }

    private calculateAverageDailyVolume(totalAudience: number, startDate: Date | null, endDate: Date): number {
        if (!startDate || totalAudience === 0) return 0;

        const daysDifference = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)));
        return Math.round(totalAudience / daysDifference);
    }

    async getBotStatistics(mailingReservationId: number): Promise<BotStatistics> {
        const reservation = await this.prisma.mailingReservation.findUnique({
            where: { id: mailingReservationId },
            include: {
                MailingEntrances: true,
                botSeller: true,
                mailing: true
            }
        });        if (!reservation) {
            throw new NotFoundException('Mailing reservation not found');
        }

        // Get all entrances for this reservation
        const entrances = reservation.MailingEntrances;
        const uniqueUsers = new Set(entrances.map(e => e.userTelegramId));
        
        // Calculate click statistics with 4-hour freeze logic
        const clickStats = await this.calculateClickStatistics(entrances);
        
        // Get user statistics from bot data
        const userStats = await this.calculateUserStatistics(reservation.botSeller.usersData, entrances);
        
        // Calculate conversion statistics
        const conversionStats = await this.calculateConversionStatistics(entrances);
        
        // Analyze audience by country
        const audienceAnalysis = await this.analyzeAudienceByCountry(entrances);

        return {
            totalClicks: clickStats.total,
            uniqueClicks: clickStats.unique,
            userStats,
            conversionStats,
            audienceAnalysis
        };
    }

    async getChannelStatistics(mailingReservationId: number): Promise<ChannelStatistics> {
        const reservation = await this.prisma.mailingReservation.findUnique({
            where: { id: mailingReservationId },
            include: {
                botSeller: true,
                mailing: true
            }
        });        if (!reservation) {
            throw new NotFoundException('Mailing reservation not found');
        }

        const botSeller = reservation.botSeller;
        
        // Calculate audience statistics for channel
        const audienceCountries = await this.analyzeChannelAudience(botSeller.usersData);
        
        return {
            cleanSubscribers: botSeller.channelAudience || 0,
            subscriberTurnover: botSeller.channelDailyPeopleIncome || 0,
            audienceCountries,
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
                botSeller: true,
                MailingEntrances: true
            },
            orderBy: {
                processedAt: 'asc'
            }
        });

        // Calculate totals
        const totalMoneyEarned = await this.calculateTotalMoneyEarned(reservations);
        const totalMailingsSold = reservations.length;
        const totalAudienceProvided = this.calculateUniqueAudienceFromReservations(reservations);

        // Calculate average daily earnings - use the earliest entrance date if processedAt is null
        let firstDate = reservations[0]?.processedAt;
        if (!firstDate && reservations.length > 0) {
            // If no processedAt, use the earliest entrance date
            const allEntrances = reservations.flatMap(r => r.MailingEntrances);
            if (allEntrances.length > 0) {
                firstDate = allEntrances.reduce((earliest, entrance) => {
                    const entranceDate = new Date(entrance.date);
                    return !earliest || entranceDate < earliest ? entranceDate : earliest;
                }, null as Date | null);
            }
        }

        const averageDailyEarnings = this.calculateAverageDailyEarnings(
            totalMoneyEarned,
            firstDate,
            now
        );
        const sellerStats = await Promise.all(
            reservations.map(async (reservation) => {
                return {
                    link: reservation.botSeller.link || '',
                    audienceProvided: this.calculateUniqueAudienceFromReservations([reservation]),
                    moneyEarned: await this.calculateTotalMoneyEarned([reservation]),
                };
            })
        );

        return {
            totalMoneyEarned,
            totalMailingsSold,
            averageDailyEarnings,
            totalAudienceProvided,
            periods: {
                day: await this.calculateSellerPeriodStatisticsByEntranceDate(reservations, dayAgo),
                week: await this.calculateSellerPeriodStatisticsByEntranceDate(reservations, weekAgo),
                allTime: await this.calculateSellerPeriodStatistics(reservations)
            },
            sellers: sellerStats
        };
    }

    private async calculateSellerPeriodStatisticsByEntranceDate(reservations: any[], fromDate: Date): Promise<SellerPeriodStatistics> {
        // Filter reservations that have entrances within the period
        const reservationsWithRecentEntrances = reservations.map(reservation => ({
            ...reservation,
            MailingEntrances: reservation.MailingEntrances.filter(entrance => 
                new Date(entrance.date) >= fromDate
            )
        })).filter(reservation => reservation.MailingEntrances.length > 0);

        const audienceProvided = this.calculateUniqueAudienceFromReservations(reservationsWithRecentEntrances);
        const mailingsSold = reservationsWithRecentEntrances.length;
        const moneyEarned = await this.calculateTotalMoneyEarnedForPeriod(reservationsWithRecentEntrances);

        return {
            audienceProvided,
            moneyEarned,
            mailingsSold
        };
    }

    private async calculateSellerPeriodStatistics(reservations: any[]): Promise<SellerPeriodStatistics> {
        const audienceProvided = this.calculateUniqueAudienceFromReservations(reservations);
        const mailingsSold = reservations.length;
        const moneyEarned = await this.calculateTotalMoneyEarned(reservations);

        return {
            audienceProvided,
            moneyEarned,
            mailingsSold
        };
    }

    private async calculateTotalMoneyEarned(reservations: any[]): Promise<number> {
        let totalEarned = 0;

        for (const reservation of reservations) {
            const targetBot = await this.prisma.mailingTargetBots.findFirst({
                where: {
                    mailingId: reservation.mailingId,
                    botSellerId: reservation.botSellerId
                }
            });

            // Calculate unique entrances for this reservation
            const uniqueUserIds = new Set();
            if (reservation.MailingEntrances && reservation.MailingEntrances.length > 0) {
                reservation.MailingEntrances.forEach(entrance => {
                    uniqueUserIds.add(entrance.userTelegramId);
                });
            }
            const entranceCount = uniqueUserIds.size;

            if (targetBot?.paymentType === 'fixed') {
                // Fixed payment: only seller price (without service commission)
                const sellerPrice = reservation.botSeller.fixedPrice || 0;
                totalEarned += sellerPrice;

            } else if (targetBot?.paymentType === 'subscriber') {
                // Per subscriber payment: calculate based on actual unique entrances
                const pricePerSubscriber = reservation.botSeller.subscriberPrice || 0;
                const sellerAmount = pricePerSubscriber * entranceCount;
                totalEarned += sellerAmount;

            } else {
                // Fallback to fixed price
                const sellerPrice = reservation.botSeller.fixedPrice || 0;
                totalEarned += sellerPrice;
            }
        }

        return totalEarned;
    }

    private async calculateTotalMoneyEarnedForPeriod(reservations: any[]): Promise<number> {
        let totalEarned = 0;

        for (const reservation of reservations) {
            const targetBot = await this.prisma.mailingTargetBots.findFirst({
                where: {
                    mailingId: reservation.mailingId,
                    botSellerId: reservation.botSellerId
                }
            });

            // Calculate unique entrances for this reservation (filtered entrances)
            const uniqueUserIds = new Set();
            if (reservation.MailingEntrances && reservation.MailingEntrances.length > 0) {
                reservation.MailingEntrances.forEach(entrance => {
                    uniqueUserIds.add(entrance.userTelegramId);
                });
            }
            const entranceCount = uniqueUserIds.size;

            if (targetBot?.paymentType === 'fixed') {
                // For fixed payment, only count if there are entrances in this period
                if (entranceCount > 0) {
                    const sellerPrice = reservation.botSeller.fixedPrice || 0;
                    totalEarned += sellerPrice;
                }

            } else if (targetBot?.paymentType === 'subscriber') {
                // Per subscriber payment: calculate based on actual unique entrances in period
                const pricePerSubscriber = reservation.botSeller.subscriberPrice || 0;
                const sellerAmount = pricePerSubscriber * entranceCount;
                totalEarned += sellerAmount;

            } else {
                // Fallback to fixed price, only if there are entrances
                if (entranceCount > 0) {
                    const sellerPrice = reservation.botSeller.fixedPrice || 0;
                    totalEarned += sellerPrice;
                }
            }
        }

        return totalEarned;
    }

    private calculateAverageDailyEarnings(totalEarnings: number, startDate: Date | null, endDate: Date): number {
        if (!startDate || totalEarnings === 0) return 0;

        const daysDifference = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)));
        return parseFloat((totalEarnings / daysDifference).toFixed(2));
    }

    async formatBotStatistics(stats: BotStatistics): Promise<string> {
        const total = stats.totalClicks;
        
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

🌍 Анализ аудитории
${Object.entries(stats.audienceAnalysis)
    .map(([country, data]) => `${country} ${data.count} чел. (${data.percentage.toFixed(2)}%)`)
    .join('\n')}
        `.trim();
    }

    async formatChannelStatistics(stats: ChannelStatistics): Promise<string> {
        return `
📺 Статистика канала

Чистые пдп: ${stats.cleanSubscribers}
Оборот пдп: ${stats.subscriberTurnover}

Страны аудитории:
${Object.entries(stats.audienceCountries)
    .map(([country, data]) => `${country} ${data.count} (${data.percentage.toFixed(1)}%)`)
    .join('\n')}

Ссылка на ресурс: ${stats.resourceLink}
        `.trim();
    }

    private async calculateClickStatistics(entrances: any[]): Promise<{ total: number; unique: number }> {
        const FREEZE_HOURS = 4;
        const freezeTimeMs = FREEZE_HOURS * 60 * 60 * 1000;
        
        // Group entrances by user
        const userEntrances = entrances.reduce((acc, entrance) => {
            if (!acc[entrance.userTelegramId]) {
                acc[entrance.userTelegramId] = [];
            }
            acc[entrance.userTelegramId].push(entrance);
            return acc;
        }, {});

        let totalValidClicks = 0;
        const uniqueUsers = new Set();

        // Calculate valid clicks considering freeze period
        Object.entries(userEntrances).forEach(([userId, userEntranceList]: [string, any[]]) => {
            const sortedEntrances = userEntranceList.sort((a, b) => 
                new Date(a.date).getTime() - new Date(b.date).getTime()
            );

            let lastValidClickTime = 0;
            let userValidClicks = 0;

            sortedEntrances.forEach(entrance => {
                const clickTime = new Date(entrance.date).getTime();
                
                if (clickTime - lastValidClickTime >= freezeTimeMs) {
                    totalValidClicks++;
                    userValidClicks++;
                    lastValidClickTime = clickTime;
                }
            });

            if (userValidClicks > 0) {
                uniqueUsers.add(userId);
            }
        });

        return {
            total: totalValidClicks,
            unique: uniqueUsers.size
        };
    }

    private async calculateUserStatistics(usersData: any, entrances: any[]): Promise<any> {
        // Parse users data from bot
        const userData = typeof usersData === 'string' ? JSON.parse(usersData) : usersData;
        const entranceUserIds = new Set(entrances.map(e => e.userTelegramId.toString()));

        let newUsers = 0;
        let deadUsers = 0;
        let premiumUsers = 0;
        let rtlUsers = 0;

        // Analyze user data based on bot statistics
        if (userData && userData.users) {
            userData.users.forEach((user: any) => {
                if (entranceUserIds.has(user.id?.toString())) {
                    if (user.isNew) newUsers++;
                    if (user.isDead || user.isBlocked) deadUsers++;
                    if (user.isPremium) premiumUsers++;
                    if (this.hasRTLCharacters(user.username || user.firstName || '')) rtlUsers++;
                }
            });
        }

        return { new: newUsers, dead: deadUsers, premium: premiumUsers, rtl: rtlUsers };
    }

    private async calculateConversionStatistics(entrances: any[]): Promise<any> {
        // This would require additional tracking data from the bot
        // For now, return placeholder values
        return {
            performedActions: 0,
            passedSponsors: 0,
            leftAfterStart: 0
        };
    }

    private async analyzeAudienceByCountry(entrances: any[]): Promise<Record<string, { count: number, percentage: number }>> {
        // This would require country data from user profiles
        // For now, return placeholder structure
        const total = entrances.length;
        const countries = {
            'RU': { count: Math.floor(total * 0.7), percentage: 70 },
            'EN': { count: Math.floor(total * 0.2), percentage: 20 },
            'KZ': { count: Math.floor(total * 0.1), percentage: 10 }
        };

        return countries;
    }

    private async analyzeChannelAudience(usersData: any): Promise<Record<string, { count: number, percentage: number }>> {
        const userData = typeof usersData === 'string' ? JSON.parse(usersData) : usersData;
        
        // Analyze channel audience by country
        const countries: Record<string, number> = {};
        let total = 0;

        if (userData && userData.subscribers) {
            userData.subscribers.forEach((subscriber: any) => {
                const country = subscriber.country || 'Unknown';
                countries[country] = (countries[country] || 0) + 1;
                total++;
            });
        }

        // Convert to percentage format
        const result: Record<string, { count: number, percentage: number }> = {};
        Object.entries(countries).forEach(([country, count]) => {
            result[country] = {
                count,
                percentage: total > 0 ? (count / total) * 100 : 0
            };
        });

        return result;
    }

    private hasRTLCharacters(text: string): boolean {
        const rtlRegex = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
        return rtlRegex.test(text);
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
        });        if (!reservation) {
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
                MailingEntrances: {
                    some: {
                        date: {
                            gte: startDate
                        }
                    }
                }
            },
            include: {
                mailing: true,
                botSeller: true,
                MailingEntrances: {
                    where: {
                        date: {
                            gte: startDate
                        }
                    }
                }
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
                    userId: userId
                },
                adminApprovalStatus: 'APPROVED',
                MailingEntrances: {
                    some: {
                        date: {
                            gte: startDate
                        }
                    }
                }
            },
            include: {
                mailing: true,
                botSeller: true,
                MailingEntrances: {
                    where: {
                        date: {
                            gte: startDate
                        }
                    }
                }
            }
        });

        return await this.groupSellerReservationsByMonth(reservations, months);
    }

    private async groupUserReservationsByMonth(reservations: any[], months: number): Promise<MonthlyUserStatistics[]> {
        const now = new Date();
        const monthlyData = new Map<string, any>();

        // Initialize all months with zero values
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

        // Group entrances by month and reservation
        for (const reservation of reservations) {
            const entrancesByMonth = new Map<string, any[]>();
            
            for (const entrance of reservation.MailingEntrances) {
                const entranceDate = new Date(entrance.date);
                const monthKey = `${entranceDate.getFullYear()}-${String(entranceDate.getMonth() + 1).padStart(2, '0')}`;
                
                if (monthlyData.has(monthKey)) {
                    if (!entrancesByMonth.has(monthKey)) {
                        entrancesByMonth.set(monthKey, []);
                    }
                    entrancesByMonth.get(monthKey)!.push(entrance);
                }
            }

            // Process each month that has entrances for this reservation
            for (const [monthKey, monthEntrances] of entrancesByMonth) {
                const monthData = monthlyData.get(monthKey)!;
                
                // Create a filtered reservation for this month
                const monthReservation = {
                    ...reservation,
                    MailingEntrances: monthEntrances
                };

                monthData.reservations.push(monthReservation);
            }
        }

        // Calculate statistics for each month
        const results: MonthlyUserStatistics[] = [];
        for (const [monthKey, monthData] of monthlyData) {
            if (monthData.reservations.length > 0) {
                const audience = this.calculateUniqueAudienceFromReservations(monthData.reservations);
                const uniqueReservations = new Set(monthData.reservations.map(r => r.id)).size;
                const moneySpent = await this.calculateTotalMoneySpentForPeriod(monthData.reservations);
                
                monthData.audienceAttracted = audience;
                monthData.moneySpent = moneySpent;
                monthData.mailingsPurchased = uniqueReservations;
            }

            // Remove the reservations array before returning
            delete monthData.reservations;
            results.push(monthData);
        }

        return results;
    }

    private async groupSellerReservationsByMonth(reservations: any[], months: number): Promise<MonthlySellerStatistics[]> {
        const now = new Date();
        const monthlyData = new Map<string, any>();

        // Initialize all months with zero values
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

        // Group entrances by month and reservation
        for (const reservation of reservations) {
            const entrancesByMonth = new Map<string, any[]>();
            
            for (const entrance of reservation.MailingEntrances) {
                const entranceDate = new Date(entrance.date);
                const monthKey = `${entranceDate.getFullYear()}-${String(entranceDate.getMonth() + 1).padStart(2, '0')}`;
                
                if (monthlyData.has(monthKey)) {
                    if (!entrancesByMonth.has(monthKey)) {
                        entrancesByMonth.set(monthKey, []);
                    }
                    entrancesByMonth.get(monthKey)!.push(entrance);
                }
            }

            // Process each month that has entrances for this reservation
            for (const [monthKey, monthEntrances] of entrancesByMonth) {
                const monthData = monthlyData.get(monthKey)!;
                
                // Create a filtered reservation for this month
                const monthReservation = {
                    ...reservation,
                    MailingEntrances: monthEntrances
                };

                monthData.reservations.push(monthReservation);
            }
        }

        // Calculate statistics for each month
        const results: MonthlySellerStatistics[] = [];
        for (const [monthKey, monthData] of monthlyData) {
            if (monthData.reservations.length > 0) {
                const audience = this.calculateUniqueAudienceFromReservations(monthData.reservations);
                const uniqueReservations = new Set(monthData.reservations.map(r => r.id)).size;
                const moneyEarned = await this.calculateTotalMoneyEarnedForPeriod(monthData.reservations);
                
                monthData.audienceProvided = audience;
                monthData.moneyEarned = moneyEarned;
                monthData.mailingsSold = uniqueReservations;
            }

            // Remove the reservations array before returning
            delete monthData.reservations;
            results.push(monthData);
        }

        return results;
    }
}
