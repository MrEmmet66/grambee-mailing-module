import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "prisma/prisma.service";
import { MailingService } from "./services/mailing.service";

@Injectable()
export class MailingScheduleService {
    constructor(
        private readonly prismaService: PrismaService,
        private readonly mailingService: MailingService
    ) { }
    private readonly logger = new Logger(MailingScheduleService.name);

    @Cron(CronExpression.EVERY_DAY_AT_3PM)
    async handleDailyMailing() {
        this.logger.log("Running daily mailing task");
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

        const todayMailingReservations = await this.prismaService.mailingReservation.findMany({
            where: {
                date: {
                    gte: startOfDay,
                    lt: endOfDay
                },
                isProcessed: false,
                mailing: {
                    isActive: true,
                    status: 'APPROVED'
                }
            },
            include: {
                mailing: true,
                botSeller: true,
            }
        });

        this.logger.log(`Found ${todayMailingReservations.length} mailing reservations for today`);

        for (const reservation of todayMailingReservations) {
            if (!reservation.mailing) {
                this.logger.warn(`Skipping reservation ${reservation.id} - mailing not found or not active/approved`);
                continue;
            }

            try {
                await this.mailingService.processMailing(reservation);
            } catch (error) {
                this.logger.error(`Error processing mailing ${reservation.mailingId} for bot seller ${reservation.botSellerId}:`, error);
            }
        }
    }

    async runMailingById(mailingId: number) {
        this.logger.log(`Running mailing in schedule service by ID: ${mailingId}`);

        // Сначала проверим саму рассылку
        const mailing = await this.prismaService.mailing.findUnique({
            where: { id: mailingId }
        });

        this.logger.log(`Mailing ${mailingId} details:`, {
            id: mailing?.id,
            isActive: mailing?.isActive,
            status: mailing?.status
        });

        // Теперь все резервации без фильтров по статусу рассылки
        const allReservations = await this.prismaService.mailingReservation.findMany({
            where: {
                mailingId: mailingId,
                isProcessed: false
            },
            include: {
                mailing: true,
                botSeller: true,
            }
        });

        this.logger.log(`All unprocessed reservations for mailing ${mailingId}:`,
            allReservations.map(r => ({
                id: r.id,
                isProcessed: r.isProcessed,
                mailingIsActive: r.mailing?.isActive,
                mailingStatus: r.mailing?.status
            }))
        );

        // Фильтруем только активные и одобренные
        const validReservations = allReservations.filter(r =>
            r.mailing?.status === 'APPROVED'
        );

        this.logger.log(`Valid reservations found: ${validReservations.length}`);

        for (const reservation of validReservations) {
            await this.mailingService.processMailing(reservation);
        }
    }
}