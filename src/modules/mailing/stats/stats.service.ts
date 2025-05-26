import { Injectable } from "@nestjs/common";
import { PrismaService } from "prisma/prisma.service";

interface BotStatistics {
    totalClicks: number;
    uniqueClicks: number;
    userStats: {
        new: number;
        dead: number;
        premium: number;
        rtl: number;
    };
    conversionStats: {
        performedActions: number;
        passedSponsors: number;
        leftAfterStart: number;
    };
    audienceAnalysis: Record<string, { count: number; percentage: number }>;
}

interface ChannelStatistics {
    cleanSubscribers: number;
    subscriberTurnover: number;
    audienceCountries: Record<string, { count: number; percentage: number }>;
    resourceLink: string;
}

@Injectable()
export class StatsService {
    constructor(private readonly prisma: PrismaService) {}

    async getBotStatistics(mailingReservationId: number): Promise<BotStatistics> {
        const reservation = await this.prisma.mailingReservation.findUnique({
            where: { id: mailingReservationId },
            include: {
                MailingEntrances: true,
                botSeller: true,
                mailing: true
            }
        });

        if (!reservation) {
            throw new Error('Mailing reservation not found');
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
        });

        if (!reservation) {
            throw new Error('Mailing reservation not found');
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
        });

        if (!reservation) {
            throw new Error('Mailing reservation not found');
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
}
