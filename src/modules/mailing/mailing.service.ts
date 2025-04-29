/*
https://docs.nestjs.com/providers#services
*/

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateMailingDto, CreateMailingFormData } from './dto/createMailing.dto';
import { PrismaService } from 'prisma/prisma.service';
import { CreateMailingReservationDto } from './dto/createMailingReservation.dto';

@Injectable()
export class MailingService {
    constructor(private readonly prismaService: PrismaService) {}

    async createMailing(dto: CreateMailingFormData) {
        const jsonPostButtons = JSON.stringify(dto.buttons);
        const mediaPath = dto.media ? dto.media.path : null;

        return await this.prismaService.mailing.create({
            data: {
                botToken: dto.botToken,
                postMedia: mediaPath,
                postContent: dto.content,
                postMediaType: dto.mediaType,
                postButtons: jsonPostButtons,
                userId: dto.userId,
            }
        });
    }

    async toggleMailingStatus(mailingId: number) {
        const mailing = await this.prismaService.mailing.findUnique({
            where: {
                id: mailingId
            }
        })

        if (!mailing) {
            throw new NotFoundException('Mailing not found');
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
