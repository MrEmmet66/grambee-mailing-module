/*
https://docs.nestjs.com/providers#services
*/

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateMailingDto, CreateMailingFormData } from './dto/createMailing.dto';
import { PrismaService } from 'prisma/prisma.service';
import { CreateMailingReservationDto, MailingFilters } from './dto/createMailingReservation.dto';
import { TelegramService } from '../telegram/telegram.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailingService {
    constructor(
        private readonly prismaService: PrismaService, 
        private telegramService: TelegramService,
        private httpService: HttpService,
        private configService: ConfigService,

    ) {}

    async createMailing(dto: CreateMailingFormData) {
        const jsonPostButtons = JSON.stringify(dto.buttons);
        const mediaPath = dto.media ? dto.media.path : null;

        const mailing =  await this.prismaService.mailing.create({
            data: {
                botToken: dto.botToken,
                postMedia: mediaPath,
                postContent: dto.content,
                postMediaType: dto.mediaType,
                postButtons: jsonPostButtons,
                userId: dto.userId,
            }
        });

        await this.telegramService.sendMailingApplication(mailing);
    }

    async getUserMailings(userId: number) {
        return await this.prismaService.mailing.findMany({
            where: {
                userId: userId
            }
        })
    }

    async toggleMailingStatus(mailingId: number) {
        const gatewayUrl = this.configService.get<string>('GATEWAY_URL');
        const mailing = await this.prismaService.mailing.findUnique({
            where: {
                id: mailingId
            }
        })

        if (!mailing) {
            throw new NotFoundException('Mailing not found');
        }

        const mailingReservations = await this.prismaService.mailingReservation.findMany({
            where: {
                mailingId: mailingId
            },
            include: {
                botSeller: true
            }
        })

        if (mailingReservations.length === 0) {
            throw new ConflictException('No reservations found for this mailing');
        }

        if (mailing.isActive) {
            throw new ConflictException('Mailing is already active');
        }
        

        let totalAmount = 0;
        mailingReservations.forEach(reservation => {
            if (reservation.botSeller.fixedPrice) {
                totalAmount += reservation.botSeller.fixedPrice;
            }
        });

        try {
            const holdEndpoint = `${gatewayUrl}api/v1/balance/${mailing.userId}/hold`;
            const holdData = {
                amount: totalAmount,
                description: `Удержание баланса за рассылку #${mailingId} с ${mailingReservations.length} каналами.`,
                telegramId: mailing.userId.toString()
            };
            
            await this.httpService.post(holdEndpoint, holdData).toPromise();
        } catch (error) {
            throw new ConflictException('Failed to hold balance for mailing');
        }

        return await this.prismaService.mailing.update({
            where: {
                id: mailingId
            },
            data: {
                isActive: !mailing.isActive
            }
        })
    }

    async reserveMailingDay(dto: CreateMailingReservationDto) {
        const jsonSelectedFilters = JSON.stringify(dto.selectedFilters);

        const existingReservation = await this.prismaService.mailingReservation.findFirst({
            where: {
                date: dto.date
            }
        })

        if (existingReservation) {
            throw new ConflictException('Mailing day already reserved');
        }

        return await this.prismaService.mailingReservation.create({
            data: {
                mailingId: dto.mailingId,
                botSellerId: dto.sellerId,
                date: dto.date,
                selectedFilters: jsonSelectedFilters
            }
        })
    }
}
