/*
https://docs.nestjs.com/providers#services
*/

import { ConflictException, forwardRef, Inject, Injectable, InternalServerErrorException, Logger, NotAcceptableException, NotFoundException, PreconditionFailedException } from '@nestjs/common';
import { CreateMailingDto, CreateMailingFormData, UpdateMailingContentFormData } from '../dto/createMailing.dto';
import { PrismaService } from 'prisma/prisma.service';
import { TelegramService } from '../../telegram/telegram.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import * as fs from "fs";
import * as readline from "readline";
import { setTimeout } from "timers/promises";
import { Application } from 'express';
import { ApplicationsService } from '../../telegram/applications.service';
import { MailingNotifyProps } from 'src/modules/telegram/telegram.types';
import { mkdirSync } from 'fs';
import { BotSeller, MailingReservation, MailingTargetBots } from '@prisma/client';
import { BalanceService } from '../../balance/balance.service';
import { ReservationService } from './reservation.service';
import { ProcessorService } from './processor.service';

@Injectable()
export class MailingService {
    private readonly logger = new Logger(MailingService.name);    constructor(
        private readonly prismaService: PrismaService,
        @Inject(forwardRef(() => ApplicationsService))
        private applicationsService: ApplicationsService,
        @Inject(forwardRef(() => TelegramService))
        private readonly telegramService: TelegramService,
        private readonly balanceService: BalanceService,
        private httpService: HttpService,
        private configService: ConfigService,
        private readonly reservationService: ReservationService,
        private readonly processorService: ProcessorService, // добавляем зависимость
    ) { }    async getMailingOwnerTelegramId(mailingId: number) {
        const mailing = await this.prismaService.mailing.findUnique({
            where: { id: mailingId },
            include: { user: true }
        });

        if (!mailing) {
            throw new NotFoundException(`Mailing with ID ${mailingId} not found`);
        }

        return mailing.user.telegramId;
    }

    async deleteMailing(mailingId: number) {
        const mailing = await this.prismaService.mailing.findUnique({
            where: { id: mailingId }
        });

        if (!mailing) {
            throw new NotFoundException(`Mailing with ID ${mailingId} not found`);
        }

        if (mailing.isActive) {
            throw new ConflictException(`Mailing with ID ${mailingId} is active and cannot be deleted`);
        }

        // Delete all reservations for this mailing
        await this.prismaService.mailingReservation.deleteMany({
            where: { mailingId: mailingId }
        });

        await this.prismaService.mailingTargetBots.deleteMany({
            where: { mailingId: mailingId }
        });

        // Delete the mailing itself
        return await this.prismaService.mailing.delete({
            where: { id: mailingId }
        });
    }    async updateMailingContent(mailingId: number, updateData: UpdateMailingContentFormData) {
        return await this.prismaService.mailing.update({
            where: { id: mailingId },
            data: {
                postContent: updateData.content,
                postMediaType: updateData.mediaType,
                postMedia: updateData.media ? `/uploads/${updateData.media.filename}` : null,
                postButtons: updateData.buttonContent, // Store button text directly
            }
        });

    }

    async updateMailingReservationForwardedMessage(reservationId: number, messageId: number) {
        const reservation = await this.prismaService.mailingReservation.findUnique({
            where: { id: reservationId }
        });

        if (!reservation) {
            throw new NotFoundException(`Reservation with ID ${reservationId} not found`);
        }

        return await this.prismaService.mailingReservation.update({
            where: { id: reservationId },
            data: {
                forwardedMessageId: String(messageId) // Store as string to avoid issues with large numbers
            }
        });
    }




    async getMailingById(mailingId: number) {
        const mailing = await this.prismaService.mailing.findUnique({
            where: {
                id: mailingId
            }
        });

        if (!mailing) {
            throw new NotFoundException(`Mailing with ID ${mailingId} not found`);
        }

        return mailing;
    }

    async createMailing(dto: CreateMailingDto) {
        this.logger.log(`Creating mailing with data: ${JSON.stringify({
            userId: dto.userId,
            link: dto.link,
            isChannel: !!dto.isChannel,
            hasMedia: !!dto.media,
            contentLength: dto.content?.length || 0,
            buttonText: dto.buttonContent || 'No button'
        })}`);

        // get user by id or telegramId
        const user = await this.prismaService.user.findFirst({
            where: {
                OR: [
                    { id: dto.userId },
                    { telegramId: String(dto.userId) } // Support both ID and Telegram ID
                ]
            }
        });


        if (!user) {
            throw new NotFoundException(`User with ID ${dto.userId} not found`);
        }

        // If there's a media file, use its path
        const mediaPath = dto.media ? `/uploads/${dto.media.filename}` : null;

        try {


            const existingMailing = await this.prismaService.mailing.findFirst({
                where: {
                    OR: [
                        ...(dto.botToken ? [{ botToken: dto.botToken }] : []),
                        ...(dto.link ? [{ link: dto.link }] : [])
                    ]
                }
            });

            if (existingMailing) {
                this.logger.warn(`Mailing with the same botToken, channelId or botLink already exists`);
                throw new ConflictException(`Mailing with the same botToken, channelId or botLink already exists`);
            }

            const existingBotSeller = await this.prismaService.botSeller.findFirst({
                where: {
                    OR: [
                        { botToken: dto.botToken },
                        { link: dto.link },
                    ]
                }
            });

            if (existingBotSeller) {
                this.logger.warn(`BotSeller with the same botToken, channelId or link already exists`);
                throw new ConflictException(`BotSeller with the same botToken, channelId or link already exists`);
            }

            // Store button text directly (no need for JSON parsing)
            const mailing = await this.prismaService.mailing.create({
                data: {
                    botToken: dto.botToken,
                    userId: user.id,
                    link: dto.link || '',
                    isChannel: dto.isChannel,
                    postContent: dto.content,
                    postMediaType: dto.mediaType,
                    postMedia: mediaPath,
                    postButtons: dto.buttonContent, // Just store the button text
                    status: 'PENDING'
                }
            });

            this.logger.log(`Mailing created with ID: ${mailing.id}`);

            // Send application to Telegram
            await this.applicationsService.sendMailingApplication(mailing);

            return mailing;
        } catch (error) {
            this.logger.error(`Error creating mailing: ${error.message}`);
            throw error;
        }
    }

    async getUserMailings(userId: number) {
        this.logger.log(`Getting mailings for user ID: ${userId}`);
        console.log(`Getting mailings for user ID: ${userId}`);
        
        return await this.prismaService.mailing.findMany({
            where: {
                user: { telegramId: String(userId) } // Support both ID and Telegram ID
            },
            include: {
                user: true,
            }
        })
    }

    async toggleMailingStatus(mailingId: number) {
        const mailing = await this.prismaService.mailing.findUnique({
            where: {
                id: mailingId
            },
            include: {
                user: true,
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
        }        return await this.prismaService.mailing.update({
            where: {
                id: mailingId
            },
            data: {
                isActive: !mailing.isActive
            }
        });
    }    async processMailing(reservation) {
        return this.processorService.processMailing(reservation);
    }
    async sendToChannel(botSeller, mailing, buttons) {
        return this.processorService.sendToChannel(botSeller, mailing, buttons);
    }
    async sendToBotUsers(botSeller, mailing, buttons) {
        return this.processorService.sendToBotUsers(botSeller, mailing, buttons);
    }
    async readUserList(filePath: string) {
        return this.processorService.readUserList(filePath);
    }
    applyFilters(users, filters) {
        return this.processorService.applyFilters(users, filters);
    }
    buildInlineKeyboard(buttons) {
        return this.processorService.buildInlineKeyboard(buttons);
    }
    async sendTextMessage(botToken, chatId, text, inlineKeyboard) {
        return this.processorService.sendTextMessage(botToken, chatId, text, inlineKeyboard);
    }
    async sendMediaMessage(botToken, chatId, mailing, inlineKeyboard) {
        return this.processorService.sendMediaMessage(botToken, chatId, mailing, inlineKeyboard);
    }
    async updateMailingStatistics(botSeller, mailing) {
        return this.processorService.updateMailingStatistics(botSeller, mailing);
    }
    createButtonWithInviteLink(buttonText: string, inviteLink: string) {
        return this.processorService.createButtonWithInviteLink(buttonText, inviteLink);
    }

    async getMessageViews(chatId: string, messageId: string): Promise<number> {
        const telethonClientUrl = this.configService.get<string>('TELETHON_CLIENT_URL', 'http://localhost:8000');
        const url = `${telethonClientUrl}/views_by_forward?forward_chat_id=${chatId}&forward_message_id=${messageId}`;

        try {
            const response = await this.httpService.get(url).toPromise();
            if (!response || response.status !== 200) {
                this.logger.error(`Failed to fetch message views: ${response ? response.statusText : 'No response'}`);
                throw new InternalServerErrorException(`Failed to fetch message views: ${response ? response.statusText : 'No response'}`);
            }
            return response.data?.views || 0;
        } catch (error) {
            this.logger.error(`Error fetching message views: ${error.message}`);
            throw error;
        }
    }

    async updateChannelViews(reservation: MailingReservation) {
        const chatId = this.configService.get<string>('ADMIN_CHAT_ID', '-1002677251791');
        if (!reservation.forwardedMessageId) {
            this.logger.warn(`Reservation ${reservation.id} does not have a forwarded message ID`);
            return;
        }

        const messageId = reservation.forwardedMessageId;
        const views = await this.getMessageViews(chatId, messageId);
        this.logger.log(`Message ${messageId} has ${views} views`);

        if(views > reservation.viewCount) {
            await this.prismaService.mailingReservation.update({
                where: {
                    id: reservation.id
                },
                data: {
                    viewCount: views
                }
            });
        }

    }




}
