/*
https://docs.nestjs.com/providers#services
*/

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../../prisma/prisma.service';

@Injectable()
export class MailingCheckoutService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly configService: ConfigService

    ) {}

    async checkoutChannelMailing(mailingReservationId: number, views: number) {
        const reservation = await this.prisma.mailingReservation.findUnique({
            where: { id: mailingReservationId },
            include: {
                mailing: true,
                botSeller: true
            }
        });

        if (!reservation) {
            throw new Error(`Mailing reservation with ID ${mailingReservationId} not found`);
        }

        if (reservation.isProcessed) {
            throw new Error(`Mailing reservation with ID ${mailingReservationId} is already processed`);
        }

        const mailingTargetBot = await this.prisma.mailingTargetBots.findFirst({
            where: {
                mailingId: reservation.mailingId,
                botSellerId: reservation.botSellerId
            }
        });

        if (!mailingTargetBot) {
            throw new Error(`Mailing target bot not found`);
        }

        // Метод нигде не вызывается: расчёт списания/возврата для канала не
        // реализован, а ветка ниже раньше молча ничего не делала и возвращала
        // необработанную резервацию. Явная ошибка честнее тихого no-op.
        throw new Error(
          `checkoutChannelMailing is not implemented (reservation ${mailingReservationId}, paymentType ${mailingTargetBot.paymentType}, views ${views})`,
        );
    }
}
