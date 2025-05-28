/*
https://docs.nestjs.com/providers#services
*/

import { ConflictException, forwardRef, Inject, Injectable, InternalServerErrorException, Logger, NotAcceptableException, NotFoundException } from '@nestjs/common';
import { CreateMailingDto, CreateMailingFormData, UpdateMailingContentFormData } from '../dto/createMailing.dto';
import { PrismaService } from 'prisma/prisma.service';
import { CreateMailingReservationDto, MailingFilters } from '../dto/createMailingReservation.dto';
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
import { BotSeller, MailingTargetBots } from '@prisma/client';

@Injectable()
export class MailingService {
    private readonly logger = new Logger(MailingService.name);

    constructor(
        private readonly prismaService: PrismaService,
        @Inject(forwardRef(() => ApplicationsService))
        private applicationsService: ApplicationsService,
        @Inject(forwardRef(() => TelegramService))
        private readonly telegramService: TelegramService,

        private httpService: HttpService,
        private configService: ConfigService,
    ) { }

    getMailingsByDate(date: Date, sellerId: string) {
        return this.prismaService.mailingReservation.findMany({
            where: {
                date: date,
                botSellerId: Number(sellerId)
            },
            include: {
                mailing: true
            }
        });
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
    }

    async removeMailingReservation(reservationId: number) {
        const reservation = await this.prismaService.mailingReservation.findUnique({
            where: { id: reservationId },
            include: {
                mailing: true
            }
        });

        if (!reservation) {
            throw new NotFoundException(`Reservation with ID ${reservationId} not found`);
        }

        // Check if the reservation is already processed
        if (reservation.isProcessed) {
            throw new ConflictException(`Reservation with ID ${reservationId} is already processed`);
        }

        if (reservation.adminApprovalStatus === 'FROZEN') {
            throw new ConflictException(`Reservation with ID ${reservationId} is frozen and cannot be deleted`);
        }

        if (reservation.mailing.isActive) {
            throw new ConflictException(`Mailing with ID ${reservation.mailingId} is active and cannot be deleted`);
        }

        // Delete the reservation
        return await this.prismaService.mailingReservation.delete({
            where: { id: reservationId }
        });
    }

    async getMailingReservationsBySellerId(sellerId: number) {
        return await this.prismaService.mailingReservation.findMany({
            where: {
                botSellerId: sellerId,
                isProcessed: false,
                adminApprovalStatus: { not: 'FROZEN' },
                date: {
                    gte: new Date()
                }

            },
            include: {
                mailing: true,
                botSeller: true
            },
            orderBy: {
                date: 'asc'
            }
        });
    }

    async updateMailingContent(mailingId: number, updateData: UpdateMailingContentFormData) {
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

    async createMailing(dto: CreateMailingFormData) {
        this.logger.log(`Creating mailing with data: ${JSON.stringify({
            userId: dto.userId,
            botToken: dto.botToken,
            channelId: dto.channelId,
            botLink: dto.botLink,
            isChannel: !!dto.channelId,
            hasMedia: !!dto.media,
            contentLength: dto.content?.length || 0,
            buttonText: dto.buttonContent || 'No button'
        })}`);



        // If there's a media file, use its path
        const mediaPath = dto.media ? `/uploads/${dto.media.filename}` : null;

        try {
            // Determine if this is a channel mailing based on channelId presence
            const isChannel = !!dto.channelId;

            const channelInfo = await this.telegramService.getChatInfo(dto.channelId || '', dto.botToken || '');
            console.log(`Channel info: ${JSON.stringify(channelInfo)}`);
            if (!channelInfo || !channelInfo.ok) {
                throw new NotFoundException(`Channel with ID ${dto.channelId} not found or bot token is invalid`);
            }

            const existingMailing = await this.prismaService.mailing.findFirst({
                where: {
                    OR: [
                        { botToken: dto.botToken },
                        { channelId: dto.channelId },
                        { botLink: dto.botLink }
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
                        { channelId: dto.channelId },
                        { link: dto.botLink }
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
                    userId: dto.userId,
                    channelId: dto.channelId,
                    botLink: dto.botLink,
                    isChannel: isChannel,
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
        }


        let totalAmount = 0;
        mailingReservations.forEach(reservation => {
            totalAmount += reservation.heldAmount;
        });

        try {
            const holdEndpoint = `${gatewayUrl}api/v1/balance/${mailing.user.telegramId}/hold`;
            const holdData = {
                amount: totalAmount * 1.0,
                description: `Удержание баланса за рассылку #${mailingId} с ${mailingReservations.length} каналами.`,
                telegramId: mailing.user.telegramId.toString()
            };

            await this.httpService.post(holdEndpoint, holdData).toPromise();
        } catch (error) {
            throw new InternalServerErrorException('Failed to hold balance for mailing: ' + error);
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

    async getMailingReservationByLink(link: string) {
        return await this.prismaService.mailingReservation.findFirst({
            where: {
                trackingLink: link,
                isProcessed: true,
                adminApprovalStatus: { not: 'FROZEN' }
            },
            include: {
                mailing: true,
                botSeller: true
            }
        });
    }

    async reserveMailingDay(dto: CreateMailingReservationDto) {
        const jsonSelectedFilters = JSON.stringify(dto.selectedFilters);

        const existingReservation = await this.prismaService.mailingReservation.findFirst({
            where: {
                date: dto.date,
                botSellerId: dto.sellerId,
            }
        });

        if (existingReservation) {
            throw new ConflictException('Mailing day already reserved');
        }

        const botSeller = await this.prismaService.botSeller.findUnique({
            where: { id: dto.sellerId }
        })

        if (!botSeller) {
            throw new NotFoundException('Bot seller not found');
        }

        const mailing = await this.getMailingById(dto.mailingId);
        if (!mailing) {
            throw new NotFoundException('Mailing not found');
        }

    

        let heldAmount = 0;

        if (dto.paymentType === 'fixed') {
            // Для фиксированной оплаты: цена продавца + $25 комиссия
            const sellerPrice = botSeller.fixedPrice || 0;
            const serviceCommission = 25;
            heldAmount = sellerPrice + serviceCommission;

        } else if (dto.paymentType === 'subscriber') {
            if (mailing.botToken === null) {
                throw new ConflictException('Bot token is required for per subscriber payment type');
            }

            if (mailing.isChannel && mailing.channelId !== null) {
                const channelInfo = await this.telegramService.getChatInfo(mailing.channelId, mailing.botToken);
                console.log(`Channel info: ${JSON.stringify(channelInfo)}`);
                
                if (!channelInfo || !channelInfo.ok) {
                    throw new NotFoundException(`Channel with ID ${mailing.channelId} not found or bot token is invalid`);
                }

                if(channelInfo.result.username) {
                    throw new NotAcceptableException(`Per subscriber payment type is not supported for public channels`);
                }


            }

            // Для оплаты за подписчика: максимальная сумма с учетом комиссии
            const maxUsers = botSeller.botLiveAudience || botSeller.channelAudience || 0;
            if (maxUsers <= 0) {
                const fixedPrice = botSeller.fixedPrice || 0;
                heldAmount = fixedPrice + this.configService.get<number>('SERVICE_COMMISSION_FIXED', 25);

            }
            else {
                const pricePerUser = botSeller.subscriberPrice || 0;
                const serviceCommissionPerUser = 0.03;

                heldAmount = (pricePerUser + serviceCommissionPerUser) * maxUsers;
            }

        } else {
            // Fallback
            heldAmount = (botSeller.fixedPrice || 0) + 25;
        }
        let trackingLink = await this.telegramService.generateTrackingLink(mailing.isChannel, mailing.channelId, dto.mailingId, dto.sellerId, botSeller.link, mailing.botToken || botSeller.botToken);

        // Create the reservation
        const reservation = await this.prismaService.mailingReservation.create({
            data: {
                mailingId: dto.mailingId,
                botSellerId: dto.sellerId,
                date: dto.date,
                selectedFilters: jsonSelectedFilters,
                heldAmount: heldAmount, // Use fixed price if available, otherwise 0
                trackingLink: trackingLink
            }
        });

        // Check if this is the first reservation for this bot-mailing combination
        const existingTargetBot = await this.prismaService.mailingTargetBots.findFirst({
            where: {
                botSellerId: dto.sellerId,
                mailingId: dto.mailingId,
                paymentType: dto.paymentType || 'fixed' // Default to 'fixed' if not provided
            }
        });

        if (!existingTargetBot) {

            // Create MailingTargetBots record with the tracking link
            await this.prismaService.mailingTargetBots.create({
                data: {
                    botSellerId: dto.sellerId,
                    mailingId: dto.mailingId,
                    link: trackingLink,
                    paymentType: dto.paymentType || 'fixed', // Default to 'fixed' if not provided
                }
            }); 
        }

        return {reservation, seller: botSeller};
    }

    async processMailing(reservation) {
        const { selectedFilters } = reservation;

        const mailing = await this.prismaService.mailing.findUnique({
            where: { id: reservation.mailingId },
            include: {
                user: true
            }
        });


        if (!mailing) {
            this.logger.error(`Mailing with ID ${reservation.mailingId} not found`);
            throw new NotFoundException(`Mailing with ID ${reservation.mailingId} not found`);
        }

        const botSeller = await this.prismaService.botSeller.findUnique({
            where: { id: reservation.botSellerId },
            include: {
                user: true
            }
        });

        if (!botSeller) {
            this.logger.error(`Bot seller with ID ${reservation.botSellerId} not found`);
            throw new NotFoundException(`Bot seller with ID ${reservation.botSellerId} not found`);
        }

        this.logger.log(`Processing mailing ${mailing.id} for ${botSeller.isChannel ? 'channel' : 'bot'} ${botSeller.id}`);

        // Parse filters
        const filters = JSON.parse(selectedFilters || '{}');

        // Find the tracking link for this mailing-botSeller combination
        const targetBot = await this.prismaService.mailingTargetBots.findFirst({
            where: {
                botSellerId: botSeller.id,
                mailingId: mailing.id
            }
        });

        // Get the invitation link to use in buttons
        const inviteLink = reservation.trackingLink || targetBot?.link || botSeller.link;

        // Create button from the button text and the invite link
        const buttonText = mailing.postButtons?.toString() || '';
        const inlineKeyboard = this.createButtonWithInviteLink(buttonText, inviteLink);

        if (botSeller.isChannel) {
            // Send to channel
            await this.sendToChannel(botSeller, mailing, inlineKeyboard);
        } else {
            // Send to bot users
            await this.sendToBotUsers(botSeller, mailing, inlineKeyboard, filters);
        }

        await this.prismaService.mailingReservation.update({
            where: { id: reservation.id },
            data: {
                isProcessed: true,
                processedAt: new Date(),
                adminApprovalStatus: 'PENDING',
            }
        });

        // Update mailing statistics
        await this.updateMailingStatistics(botSeller, mailing);

        const props: MailingNotifyProps = {
            isChannel: botSeller.isChannel,
            paymentType: targetBot?.paymentType || 'fixed',
            mailingDate: reservation.date,
            botSellerLink: botSeller.link || '',
            mailingLink: mailing.botLink || '',
            mailingOwnerUsername: mailing.user?.username || '',
            botSellerOwnerUsername: botSeller.user.username || '',
            fixedPrice: botSeller.fixedPrice || 0,
            subscriberPrice: botSeller.subscriberPrice || 0,
            reservationId: reservation.id,
        };


        await this.applicationsService.notifyAdminsAboutMailingExecution(props);
    }

    async sendToChannel(botSeller, mailing, buttons) {
        try {
            this.logger.log(`Sending message to channel ${botSeller.channelId}`);

            const inlineKeyboard = this.buildInlineKeyboard(buttons);

            // Send message based on content type
            if (mailing.postMedia) {
                await this.sendMediaMessage(botSeller.botToken, botSeller.channelId, mailing, inlineKeyboard);
            } else {
                await this.sendTextMessage(botSeller.botToken, botSeller.channelId, mailing.postContent, inlineKeyboard);
            }

            this.logger.log(`Successfully sent message to channel ${botSeller.channelId}`);
        } catch (error) {
            this.logger.error(`Failed to send message to channel ${botSeller.channelId}:`, error);
            throw error;
        }
    }

    async sendToBotUsers(botSeller, mailing, buttons, filters) {
        if (!botSeller.statisticsFilePath) {
            this.logger.warn(`No statistics file for bot ${botSeller.id}, skipping`);
            return;
        }

        try {
            const filePath = process.cwd() + botSeller.statisticsFilePath;
            this.logger.log(`Reading user statistics from ${filePath}`);

            if (!fs.existsSync(filePath)) {
                this.logger.error(`Statistics file ${filePath} does not exist`);
                return;
            }

            const userList = await this.readUserList(filePath);
            const filteredUsers = this.applyFilters(userList, filters);

            this.logger.log(`Sending message to ${filteredUsers.length} users of bot ${botSeller.id}`);

            // Process users in batches to avoid flood wait
            const batchSize = 20;
            const inlineKeyboard = this.buildInlineKeyboard(buttons);

            for (let i = 0; i < filteredUsers.length; i += batchSize) {
                const batch = filteredUsers.slice(i, i + batchSize);

                for (const user of batch) {
                    try {
                        if (mailing.postMedia) {
                            await this.sendMediaMessage(botSeller.botToken, user.userId, mailing, inlineKeyboard);
                        } else {
                            await this.sendTextMessage(botSeller.botToken, user.userId, mailing.postContent, inlineKeyboard);
                        }
                    } catch (error) {
                        this.logger.warn(`Failed to send message to user ${user.userId}:`, error);
                    }
                }

                // Wait to avoid flood wait if there are more users to process
                if (i + batchSize < filteredUsers.length) {
                    this.logger.log(`Waiting 1 second to avoid flood wait...`);
                    await setTimeout(1000);
                }
            }

            // Find mailing target record
            const mailingTarget = await this.prismaService.mailingTargetBots.findFirst({
                where: {
                    botSellerId: botSeller.id,
                    mailingId: mailing.id
                }
            });

            if (!mailingTarget) {
                // Create a new record if it doesn't exist
                await this.prismaService.mailingTargetBots.create({
                    data: {
                        botSellerId: botSeller.id,
                        mailingId: mailing.id,
                        link: botSeller.link || ''
                        // Not updating peopleInvited as requested
                    }
                });
            }

            this.logger.log(`Processed mailing for bot seller ${botSeller.id} and mailing ${mailing.id}`);

        } catch (error) {
            this.logger.error(`Error sending messages to bot users:`, error);
            throw error;
        }
    }

    async readUserList(filePath: string): Promise<Array<{ userId: string, lang?: string }>> {
        const users: Array<{ userId: string, lang?: string }> = [];

        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        for await (const line of rl) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            // Handle both formats: "userId" and "userId:lang"
            const parts = trimmedLine.split(':');
            if (parts.length === 1) {
                users.push({ userId: parts[0] });
            } else if (parts.length >= 2) {
                users.push({ userId: parts[0], lang: parts[1] });
            }
        }

        return users;
    }

    applyFilters(users: Array<{ userId: string, lang?: string }>, filters: any): Array<{ userId: string, lang?: string }> {
        if (!filters || Object.keys(filters).length === 0) {
            return users;
        }

        return users.filter(user => {
            // Language filter
            if (filters.language && user.lang && filters.language !== user.lang) {
                return false;
            }

            // Add more filter conditions as needed

            return true;
        });
    }

    // Updated buildInlineKeyboard method to handle the new format
    buildInlineKeyboard(buttons) {
        // If it's already in the right format with inline_keyboard, return as is
        if (buttons && typeof buttons === 'object' && buttons.inline_keyboard) {
            return buttons;
        }

        return undefined;
    }

    async sendTextMessage(botToken, chatId, text, inlineKeyboard) {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML',
                reply_markup: inlineKeyboard
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Failed to send message: ${JSON.stringify(errorData)}`);
        }

        return await response.json();
    }

    async sendMediaMessage(botToken, chatId, mailing, inlineKeyboard) {
        // Проверяем валидность токена
        if (!botToken || !botToken.includes(':')) {
            throw new Error(`Invalid bot token format`);
        }

        let mediaType = mailing.postMediaType || 'photo';
        let endpoint;

        switch (mediaType.toLowerCase()) {
            case 'photo':
                endpoint = 'sendPhoto';
                break;
            case 'video':
                endpoint = 'sendVideo';
                break;
            case 'document':
                endpoint = 'sendDocument';
                break;
            case 'audio':
                endpoint = 'sendAudio';
                break;
            default:
                endpoint = 'sendPhoto';
        }

        const url = `https://api.telegram.org/bot${botToken}/${endpoint}`;
        const mediaUrl = process.cwd() + mailing.postMedia;

        this.logger.log(`Attempting to send ${mediaType} from ${mediaUrl} to ${chatId}`);

        // Проверяем существование файла
        if (!fs.existsSync(mediaUrl)) {
            throw new Error(`Media file not found: ${mediaUrl}`);
        }

        // Проверяем размер файла
        const stats = fs.statSync(mediaUrl);
        this.logger.log(`File size: ${stats.size} bytes`);

        if (stats.size === 0) {
            throw new Error(`Media file is empty: ${mediaUrl}`);
        }

        // Максимальные размеры для разных типов медиа в Telegram
        const maxSizes = {
            photo: 10 * 1024 * 1024, // 10MB
            video: 50 * 1024 * 1024, // 50MB
            document: 50 * 1024 * 1024, // 50MB
            audio: 50 * 1024 * 1024 // 50MB
        };

        if (stats.size > (maxSizes[mediaType.toLowerCase()] || maxSizes.photo)) {
            throw new Error(`File too large for ${mediaType}: ${stats.size} bytes`);
        }

        try {
            // Используем axios вместо fetch для лучшей обработки ошибок
            const FormData = require('form-data');
            const formData = new FormData();

            formData.append('chat_id', chatId);

            if (mailing.postContent && mailing.postContent.trim()) {
                formData.append('caption', mailing.postContent);
                formData.append('parse_mode', 'HTML');
            }

            if (inlineKeyboard) {
                formData.append('reply_markup', JSON.stringify(inlineKeyboard));
            }

            // Определяем правильное поле для медиа
            const mediaField = mediaType.toLowerCase() === 'photo' ? 'photo' :
                mediaType.toLowerCase() === 'video' ? 'video' :
                    mediaType.toLowerCase() === 'audio' ? 'audio' : 'document';

            // Добавляем файл как stream
            formData.append(mediaField, fs.createReadStream(mediaUrl));

            const response = await this.httpService.axiosRef({
                method: 'POST',
                url: url,
                data: formData,
                headers: {
                    ...formData.getHeaders(),
                },
                timeout: 60000, // 60 секунд для больших файлов
                validateStatus: function (status) {
                    return status < 500; // Не бросать ошибку для статусов < 500
                }
            });

            this.logger.log(`Telegram API response status: ${response.status}`);
            this.logger.log(`Telegram API response data:`, response.data);

            if (response.status >= 400) {
                throw new Error(`Failed to send media message: ${JSON.stringify(response.data)}`);
            }

            return response.data;
        } catch (error) {
            this.logger.error(`Error in sendMediaMessage:`, error);

            if (error.response) {
                this.logger.error(`Response status: ${error.response.status}`);
                this.logger.error(`Response data:`, error.response.data);

                // Специальная обработка ошибок Telegram
                if (error.response.data && error.response.data.description) {
                    throw new Error(`Telegram API error: ${error.response.data.description}`);
                }
            }

            // Fallback - попробуем отправить как документ
            if (mediaType.toLowerCase() !== 'document') {
                this.logger.warn(`Failed to send as ${mediaType}, trying as document...`);
                try {
                    const documentMailing = { ...mailing, postMediaType: 'document' };
                    return await this.sendMediaMessage(botToken, chatId, documentMailing, inlineKeyboard);
                } catch (fallbackError) {
                    this.logger.error(`Fallback also failed:`, fallbackError);
                }
            }

            throw error;
        }
    }

    async updateMailingStatistics(botSeller, mailing) {
        try {
            // Update bot seller's last mailing statistics
            await this.prismaService.botSeller.update({
                where: { id: botSeller.id },
                data: {
                    lastMailingDate: new Date()
                }
            });

            this.logger.log(`Updated mailing statistics for bot seller ${botSeller.id}`);
        } catch (error) {
            this.logger.error(`Failed to update mailing statistics:`, error);
        }
    }

    async runMailingById(mailingId: number) {
        this.logger.log(`Running mailing ID: ${mailingId} manually`);

        // Find the mailing first
        const mailing = await this.prismaService.mailing.findUnique({
            where: {
                id: mailingId,
                isActive: true,
                status: 'APPROVED'
            }
        });

        if (!mailing) {
            this.logger.warn(`Mailing ID ${mailingId} not found or not active/approved`);
            throw new Error(`Mailing ID ${mailingId} not found or not active/approved`);
        }

        // Find all reservations for this mailing
        const mailingReservations = await this.prismaService.mailingReservation.findMany({
            where: {
                mailingId: mailingId
            },
            include: {
                mailing: true,
                botSeller: true
            }
        });

        if (mailingReservations.length === 0) {
            this.logger.warn(`No reservations found for mailing ID ${mailingId}`);
            throw new Error(`No reservations found for mailing ID ${mailingId}`);
        }

        this.logger.log(`Found ${mailingReservations.length} reservations for mailing ID ${mailingId}`);

        const results: Array<{
            reservationId: number;
            botSellerId: number;
            status: string;
            error?: string;
        }> = [];

        // Process each reservation immediately
        for (const reservation of mailingReservations) {
            try {
                this.logger.log(`Processing reservation ID ${reservation.id} for bot seller ${reservation.botSellerId}`);
                await this.processMailing(reservation);
                results.push({
                    reservationId: reservation.id,
                    botSellerId: reservation.botSellerId,
                    status: 'success'
                });
            } catch (error) {
                this.logger.error(`Error processing reservation ${reservation.id}:`, error);
                results.push({
                    reservationId: reservation.id,
                    botSellerId: reservation.botSellerId,
                    status: 'error',
                    error: error.message
                });
            }
        }

        return {
            mailingId,
            processedReservations: results.length,
            results
        };
    }

    async updateMailingStatus(mailingId: number, status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WAITING') {
        this.logger.log(`Updating mailing ${mailingId} status to ${status}`);

        return await this.prismaService.mailing.update({
            where: { id: mailingId },
            data: { status }
        });
    }

    // New method to create a button with the invite link
    createButtonWithInviteLink(buttonText: string, inviteLink: string) {
        if (!buttonText || !inviteLink) {
            return undefined;
        }

        // Create a simple inline keyboard with one button
        return {
            inline_keyboard: [
                [
                    {
                        text: buttonText,
                        url: inviteLink
                    }
                ]
            ]
        };
    }

}
