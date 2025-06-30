/*
https://docs.nestjs.com/providers#services
*/

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'prisma/prisma.service';

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

        const serviceDefaultSubscriberPrice = this.configService.get<number>('SERVICE_DEFAULT_SUBSCRIBER_PRICE', 0.0005);
        const serviceChannelDefaultSubscriberPrice = this.configService.get<number>('SERVICE_CHANNEL_DEFAULT_SUBSCRIBER_PRICE', 0.0002);
        let amountToPay = 0;
        let amountToRelease = 0;
        if(mailingTargetBot?.paymentType === 'fixed') {
            

        }


        return reservation;
    }
}
