/*
https://docs.nestjs.com/providers#services
*/

import { ConflictException, forwardRef, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { CreateMailingDto, CreateMailingFormData } from './dto/createMailing.dto';
import { PrismaService } from 'prisma/prisma.service';
import { CreateMailingReservationDto, MailingFilters } from './dto/createMailingReservation.dto';
import { TelegramService } from '../telegram/telegram.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import * as fs from "fs";
import * as readline from "readline";
import { setTimeout } from "timers/promises";
import { Application } from 'express';
import { ApplicationsService } from '../telegram/applications.service';

@Injectable()
export class MailingService {
    private readonly logger = new Logger(MailingService.name);

    constructor(
        private readonly prismaService: PrismaService,
        @Inject(forwardRef(() => ApplicationsService)) 
        private telegramService: ApplicationsService,
        private httpService: HttpService,
        private configService: ConfigService,
    ) {}

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
            await this.telegramService.sendMailingApplication(mailing);
            
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
            if (reservation.botSeller.fixedPrice) {
                totalAmount += reservation.botSeller.fixedPrice;
            }
        });

        try {
            const holdEndpoint = `${gatewayUrl}api/v1/balance/${mailing.user.telegramId}/hold`;
            const holdData = {
                amount: totalAmount*1.0,
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

    async reserveMailingDay(dto: CreateMailingReservationDto) {
        const jsonSelectedFilters = JSON.stringify(dto.selectedFilters);

        const existingReservation = await this.prismaService.mailingReservation.findFirst({
            where: {
                date: dto.date,
            }
        });

        if (existingReservation) {
            throw new ConflictException('Mailing day already reserved');
        }

        // Create the reservation
        const reservation = await this.prismaService.mailingReservation.create({
            data: {
                mailingId: dto.mailingId,
                botSellerId: dto.sellerId,
                date: dto.date,
                selectedFilters: jsonSelectedFilters
            }
        });

        // Check if this is the first reservation for this bot-mailing combination
        const existingTargetBot = await this.prismaService.mailingTargetBots.findFirst({
            where: {
                botSellerId: dto.sellerId,
                mailingId: dto.mailingId
            }
        });

        // If no target bot exists yet, create one with a unique tracking link
        if (!existingTargetBot) {
            // Get bot seller information
            const botSeller = await this.prismaService.botSeller.findUnique({
                where: { id: dto.sellerId }
            });

            const mailing = await this.getMailingById(dto.mailingId);
            if (!mailing) {
                throw new NotFoundException('Mailing not found');
            }

            if (!botSeller) {
                throw new NotFoundException('Bot seller not found');
            }

            let trackingLink = '';

            if (mailing.isChannel) {
                // Generate invite link for channel
                try {
                    const response = await fetch(
                        `https://api.telegram.org/bot${mailing.botToken}/createChatInviteLink`,
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                chat_id: mailing.channelId,
                                name: `Mailing_${dto.mailingId}`,
                                creates_join_request: true
                            })
                        }
                    );

                    const data = await response.json();
                    if (data.ok && data.result && data.result.invite_link) {
                        trackingLink = data.result.invite_link;
                    } else {
                        // Fallback to original link if API fails
                        trackingLink = botSeller.link;
                    }
                } catch (error) {
                    console.error('Failed to create channel invite link:', error);
                    trackingLink = botSeller.link;
                }
            } else {
                // Generate start parameter for bot
                const uniqueId = `m${dto.mailingId}_s${dto.sellerId}_${Date.now().toString(36)}`;
                const botUsername = botSeller.link.split('/').pop() || '';
                trackingLink = `https://t.me/${botUsername}?start=${uniqueId}`;
            }

            // Create MailingTargetBots record with the tracking link
            await this.prismaService.mailingTargetBots.create({
                data: {
                    botSellerId: dto.sellerId,
                    mailingId: dto.mailingId,
                    link: trackingLink
                }
            });
        }

        return reservation;
    }

    async processMailing(reservation) {
        const { mailing, botSeller, selectedFilters } = reservation;
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
        const inviteLink = targetBot?.link || botSeller.link;
        
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

        // Update mailing statistics
        await this.updateMailingStatistics(botSeller, mailing);
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

    async readUserList(filePath: string): Promise<Array<{userId: string, lang?: string}>> {
        const users: Array<{userId: string, lang?: string}> = [];
        
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

    applyFilters(users: Array<{userId: string, lang?: string}>, filters: any): Array<{userId: string, lang?: string}> {
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
        
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('caption', mailing.postContent);
        formData.append('parse_mode', 'HTML');
        
        if (inlineKeyboard) {
            formData.append('reply_markup', JSON.stringify(inlineKeyboard));
        }
        
        // Add the media file
        const mediaFile = fs.readFileSync(mediaUrl);
        const fileName = mailing.postMedia.split('/').pop();
        formData.append(mediaType.toLowerCase(), new Blob([mediaFile]), fileName);
        
        const response = await fetch(url, {
            method: 'POST',
            body: formData,
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Failed to send media message: ${JSON.stringify(errorData)}`);
        }
        
        return await response.json();
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
