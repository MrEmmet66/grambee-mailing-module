import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "prisma/prisma.service";
import { TelegramService } from "../telegram/telegram.service";

@Injectable()
export class MailingScheduleService {
    constructor(private readonly prismaService: PrismaService, private readonly telegramService: TelegramService) {}
    private readonly logger = new Logger(MailingScheduleService.name);

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async handleDailyMailing() {
        this.logger.log("Running daily mailing task");
        const todayMailingReservations = await this.prismaService.mailingReservation.findMany({
            where: {
                date: new Date(),
            },
            include: {
                mailing: true,
                botSeller: true,

            }
        });

    }
}