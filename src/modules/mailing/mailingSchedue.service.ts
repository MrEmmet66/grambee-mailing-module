import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "prisma/prisma.service";
import { MailingService } from "./mailing.service";

@Injectable()
export class MailingScheduleService {
    constructor(
        private readonly prismaService: PrismaService, 
        private readonly mailingService: MailingService
    ) {}
    private readonly logger = new Logger(MailingScheduleService.name);

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async handleDailyMailing() {
        this.logger.log("Running daily mailing task");
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const todayMailingReservations = await this.prismaService.mailingReservation.findMany({
            where: {
                date: today,
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
        return await this.mailingService.runMailingById(mailingId);
    }
}