import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { ApplicationsService } from '../../telegram/applications.service';
import { TelegramService } from '../../telegram/telegram.service';
import { BalanceService } from '../../balance/balance.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { ReservationService } from './reservation.service';
import { MailingNotifyProps } from 'src/modules/telegram/telegram.types';
import * as fs from 'fs';
import * as readline from 'readline';
import { setTimeout } from 'timers/promises';
import { FloodWaitEvent, MailingQueueWorker } from './mailing-queue.processor';
import * as Bull from 'bull';
import { BotSeller, Mailing, MailingReservation } from '@prisma/client';

@Injectable()
export class ProcessorService {
    private readonly logger = new Logger(ProcessorService.name);
    private mailingWorkers: Record<string, boolean> = {};
    private queues: Record<string, Bull.Queue> = {};
    constructor(
        private readonly prismaService: PrismaService,
        @Inject(forwardRef(() => ApplicationsService))
        private applicationsService: ApplicationsService,
        @Inject(forwardRef(() => TelegramService))
        private readonly telegramService: TelegramService,
        private readonly balanceService: BalanceService,
        private httpService: HttpService,
        private configService: ConfigService,
        private readonly reservationService: ReservationService,
        private readonly mailingQueueWorker: MailingQueueWorker,
        @Inject(forwardRef(() => require('./mailing.service').MailingService))
        private readonly mailingService: any,
    ) { }

    async processMailing(reservation: MailingReservation) {
        const mailing = await this.prismaService.mailing.findUnique({
            where: { id: reservation.mailingId },
            include: { user: true }
        });
        if (!mailing) {
            this.logger.error(`Mailing with ID ${reservation.mailingId} not found`);
            throw new Error(`Mailing with ID ${reservation.mailingId} not found`);
        }
        const botSeller = await this.prismaService.botSeller.findUnique({
            where: { id: reservation.botSellerId },
            include: { user: true }
        });
        if (!botSeller) {
            this.logger.error(`Bot seller with ID ${reservation.botSellerId} not found`);
            throw new Error(`Bot seller with ID ${reservation.botSellerId} not found`);
        }
        this.logger.log(`Processing mailing ${mailing.id} for ${botSeller.isChannel ? 'channel' : 'bot'} ${botSeller.id}`);
        const targetBot = await this.prismaService.mailingTargetBots.findFirst({
            where: { botSellerId: botSeller.id, mailingId: mailing.id }
        });
        const inviteLink = reservation.trackingLink || mailing.link;
        const buttonText = mailing.postButtons?.toString() || '';
        const inlineKeyboard = this.createButtonWithInviteLink(buttonText, inviteLink);
        if (botSeller.isChannel) {
            await this.sendToChannel(botSeller, mailing, inlineKeyboard, reservation.id);
        } else {
            await this.sendToBotUsers(botSeller, mailing, inlineKeyboard, reservation.id);
        }
        // await this.prismaService.mailingReservation.update({
        //     where: { id: reservation.id },
        //     data: {
        //         isProcessed: true,
        //         processedAt: new Date(),
        //         adminApprovalStatus: 'PENDING',
        //     }
        // });
        // await this.updateMailingStatistics(botSeller, mailing);
        // const completedMailing = await this.reservationService.checkAndDeactivateMailing(mailing.id);
        const props: MailingNotifyProps = {
            isChannel: botSeller.isChannel,
            paymentType: targetBot?.paymentType || 'fixed',
            mailingDate: reservation.date,
            botSellerLink: botSeller.link || '',
            mailingLink: mailing.link,
            mailingOwnerUsername: mailing.user?.username || '',
            botSellerOwnerUsername: botSeller.user.username || '',
            fixedPrice: botSeller.fixedPrice || 0,
            subscriberPrice: botSeller.subscriberPrice || 0,
            reservationId: reservation.id,
        };
        await this.applicationsService.notifyAdminsAboutMailingExecution(props);
    }

    async sendToChannel(botSeller, mailing, buttons, reservationId?: number) {
        try {
            this.logger.log(`Sending message to channel ${botSeller.channelId}`);
            const inlineKeyboard = this.telegramService.buildInlineKeyboard(buttons);
            let sentMessage;
            if (mailing.postMedia) {
                sentMessage = await this.telegramService.sendMediaMessage(botSeller.botToken, botSeller.channelId, mailing, inlineKeyboard);
            } else {
                sentMessage = await this.telegramService.sendTextMessage(botSeller.botToken, botSeller.channelId, mailing.postContent, inlineKeyboard);
            }
            this.logger.log(`Successfully sent message to channel ${botSeller.channelId}`);
            // --- Forward message to ADMIN_CHAT_ID if isChannel ---
            if (botSeller.isChannel && sentMessage && sentMessage.result && sentMessage.result.message_id && reservationId) {
                const adminChatId = this.configService.get('ADMIN_CHAT_ID', '-1002677251791');
                const topicId = parseInt(this.configService.get('MAILING_NOTIFY_TOPIC_ID', '15'), 10);
                const forwardUrl = `https://api.telegram.org/bot${botSeller.botToken}/forwardMessage`;
                // Формируем тело запроса
                const forwardBody: any = {
                    chat_id: adminChatId,
                    from_chat_id: botSeller.channelId,
                    message_id: sentMessage.result.message_id
                };
                // Добавляем message_thread_id только если adminChatId — супергруппа с темами
                if (adminChatId.startsWith('-100') && topicId > 0) {
                    forwardBody.message_thread_id = topicId;
                }
                this.logger.log(`Forwarding message to admin chat ${adminChatId} with topic ${topicId}`);
                const response = await fetch(forwardUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(forwardBody)
                });
                if (response.ok) {
                    const forwardResult = await response.json();
                    if (forwardResult && forwardResult.result && forwardResult.result.message_id) {
                        await this.mailingService.updateMailingReservationForwardedMessage(reservationId, forwardResult.result.message_id);
                    }
                } else {
                    let errorBody = '';
                    try { errorBody = await response.text(); } catch { }
                    this.logger.warn('Failed to forward message to admin chat', { status: response.status, body: errorBody });
                }
            }
        } catch (error) {
            this.logger.error(`Failed to send message to channel ${botSeller.channelId}:`, error);
            throw error;
        }
    }

    async sendToBotUsers(botSeller: BotSeller, mailing: Mailing, buttons, reservationId?: number) {

        if (!botSeller.statisticsFilePath) {
            this.logger.warn(`No statistics file for bot ${botSeller.id}, skipping`);
            return;
        }
        
        try {
            this.logger.log(`Processing mailing ${mailing.id} for bot ${botSeller.id} via Go worker`);
            this.logger.log(`Using statistics file URL: ${botSeller.statisticsFilePath}`);

            // Подготавливаем данные для отправки в Go микросервис
            const mailingData = {
                mailing_id: `${reservationId}_${mailing.id}`,
                bot_token: botSeller.botToken,
                users_file_url: botSeller.statisticsFilePath, // Публичный URL файла
                message_data: {
                    text: mailing.postContent || '',
                    post_media: mailing.postMedia ? (process.cwd() + mailing.postMedia) : '',
                    post_media_type: mailing.postMediaType === 'image' ? 'photo' : (mailing.postMediaType || 'photo'),
                    post_content: mailing.postContent || ''
                },
                inline_keyboard: buttons,
                rate_limit: 25, // 25 сообщений в секунду по умолчанию
                admin_chat_id: this.configService.get('MAILINGS_CHAT_ID', '-1002677251791'),
                admin_message_id: 0 // Будет установлено позже если нужно
            };

            // Отправляем запрос в Go микросервис
            const goWorkerUrl = this.configService.get('GO_MAILING_WORKER_URL', 'http://go-mailing-worker:8080');
            
            this.logger.log(`Sending mailing request to Go worker: ${goWorkerUrl}/api/v1/mailing`);
            this.logger.debug(`Mailing data:`, mailingData);
            
            const response = await this.httpService.axiosRef.post(`${goWorkerUrl}/api/v1/mailing`, mailingData, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 30000 // 30 секунд таймаут
            });

            if (response.status === 200) {
                this.logger.log(`Successfully submitted mailing to Go worker:`, response.data);
                this.logger.log(`Mailing ${mailing.id} for bot ${botSeller.id} queued in Go worker with ${response.data.total_tasks} tasks`);
                
                // Обновляем статистику рассылки
                // await this.updateMailingStatistics(botSeller, mailing);
                
                return {
                    success: true,
                    totalTasks: response.data.total_tasks,
                    totalUsers: response.data.total_users,
                    failedTasks: response.data.failed_tasks
                };
            } else {
                throw new Error(`Go worker returned status ${response.status}: ${JSON.stringify(response.data)}`);
            }

        } catch (error) {
            this.logger.error(`Error sending mailing to Go worker:`, error);
            if (error.response) {
                this.logger.error(`Go worker response error:`, {
                    status: error.response.status,
                    data: error.response.data
                });
            }
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
            if (filters.language && user.lang && filters.language !== user.lang) {
                return false;
            }
            return true;
        });
    }

    buildInlineKeyboard(buttons) {
        if (buttons && typeof buttons === 'object' && buttons.inline_keyboard) {
            return buttons;
        }
        return undefined;
    }



    async sendTextMessage(botToken, chatId, text, inlineKeyboard) {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
        if (!botToken || !botToken.includes(':')) {
            throw new Error(`Invalid bot token format`);
        }
        let mediaType = mailing.postMediaType || 'photo';
        let endpoint;
        switch (mediaType.toLowerCase()) {
            case 'photo': endpoint = 'sendPhoto'; break;
            case 'video': endpoint = 'sendVideo'; break;
            case 'document': endpoint = 'sendDocument'; break;
            case 'audio': endpoint = 'sendAudio'; break;
            default: endpoint = 'sendPhoto';
        }
        const url = `https://api.telegram.org/bot${botToken}/${endpoint}`;
        const mediaUrl = process.cwd() + mailing.postMedia;
        this.logger.log(`Attempting to send ${mediaType} from ${mediaUrl} to ${chatId}`);
        if (!fs.existsSync(mediaUrl)) {
            throw new Error(`Media file not found: ${mediaUrl}`);
        }
        const stats = fs.statSync(mediaUrl);
        this.logger.log(`File size: ${stats.size} bytes`);
        if (stats.size === 0) {
            throw new Error(`Media file is empty: ${mediaUrl}`);
        }
        const maxSizes = {
            photo: 10 * 1024 * 1024,
            video: 50 * 1024 * 1024,
            document: 50 * 1024 * 1024,
            audio: 50 * 1024 * 1024
        };
        if (stats.size > (maxSizes[mediaType.toLowerCase()] || maxSizes.photo)) {
            throw new Error(`File too large for ${mediaType}: ${stats.size} bytes`);
        }
        try {
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
            const mediaField = mediaType.toLowerCase() === 'photo' ? 'photo' :
                mediaType.toLowerCase() === 'video' ? 'video' :
                    mediaType.toLowerCase() === 'audio' ? 'audio' : 'document';
            formData.append(mediaField, fs.createReadStream(mediaUrl));
            const response = await this.httpService.axiosRef({
                method: 'POST',
                url: url,
                data: formData,
                headers: { ...formData.getHeaders() },
                timeout: 60000,
                validateStatus: function (status) { return status < 500; }
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
                if (error.response.data && error.response.data.description) {
                    throw new Error(`Telegram API error: ${error.response.data.description}`);
                }
            }
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
            await this.prismaService.botSeller.update({
                where: { id: botSeller.id },
                data: { lastMailingDate: new Date() }
            });
            this.logger.log(`Updated mailing statistics for bot seller ${botSeller.id}`);
        } catch (error) {
            this.logger.error(`Failed to update mailing statistics:`, error);
        }
    }

    createButtonWithInviteLink(buttonText: string, inviteLink: string) {
        if (!buttonText || !inviteLink) {
            return undefined;
        }
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

    /**
     * Обновляет статус рассылки (APPROVED, REJECTED, WAITING) и уведомляет владельца
     * @param mailingId ID рассылки
     * @param status Новый статус ('APPROVED' | 'REJECTED' | 'WAITING')
     */
    async updateMailingStatus(mailingId: number, status: 'APPROVED' | 'REJECTED' | 'WAITING'): Promise<boolean> {
        try {
            const mailing = await this.prismaService.mailing.findUnique({
                where: { id: mailingId },
                include: { user: true }
            });
            if (!mailing) {
                this.logger.error(`Mailing with ID ${mailingId} not found`);
                // Можно пробросить ошибку или вернуть false
                return false;
            }
            await this.prismaService.mailing.update({
                where: { id: mailingId },
                data: { status }
            });
            // Уведомление владельца рассылки (если есть Telegram ID)
            if (mailing.user?.telegramId) {
                let notifyMsg = '';
                switch (status) {
                    case 'APPROVED':
                        notifyMsg = '✅Ваша заявка на рассылку была одобрена! Для старта забронируйте дату рассылки у продавцов.';
                        break;
                    case 'REJECTED':
                        notifyMsg = '❌Ваша заявка на рассылку была отклонена!';
                        break;
                    case 'WAITING':
                        notifyMsg = '⏳Ваша заявка на рассылку отправлена в ожидание.';
                        break;
                }
                try {
                    await this.telegramService.notifyUser(mailing.user.telegramId, notifyMsg);
                } catch (err) {
                    this.logger.warn(`Failed to notify user ${mailing.user.telegramId}: ${err?.message}`);
                }
            }
            this.logger.log(`Mailing #${mailingId} status updated to ${status}`);
            return true;
        } catch (error) {
            this.logger.error(`Error updating mailing status: ${error?.message}`);
            return false;
        }
    }

    async getAverageQueueSpeed(queueName: string): Promise<number> {
        const queue = await this.prismaService.reservationQueue.findFirst({
            where: { queueName }
        });
        if (!queue) {
            this.logger.warn(`Queue ${queueName} not found`);
            return 0;
        }

        const durationSeconds = ((queue.updatedAt.getTime() || Date.now()) - queue.createdAt.getTime()) / 1000;
        if (durationSeconds <= 0) {
            this.logger.warn(`Queue ${queueName} has invalid duration: ${durationSeconds} seconds`);
            return 0;
        }

        const totalProcessed = queue.sentCount + queue.failedCount;
        if (totalProcessed === 0) {
            return 0;
        }

        // Возвращаем скорость в msg/sec
        const messagesPerSecond = totalProcessed / durationSeconds;
        return Math.round(messagesPerSecond * 100) / 100; // Округляем до 2 знаков после запятой
    }

    /**
     * Получить количество успешно отправленных сообщений для рассылки
     * @param mailingId ID рассылки
     */
    getSuccessfullySent(mailingId: number): number {
        const queueName = `mailing_${mailingId}`;
        return this.mailingQueueWorker.getSuccessfullySent(queueName);
    }

    getQueueByName(queueName: string): Bull.Queue | undefined {
        // Проксируем к воркеру, чтобы всегда получать актуальную очередь
        return this.mailingQueueWorker.getQueueByName(queueName);
    }

    getQueueFloodwaitHistory(queueName: string): FloodWaitEvent[] {
        return this.mailingQueueWorker.getFloodWaitHistory(queueName);
    }

    getQueueCurrentSpeed(queueName: string): number {
        return this.mailingQueueWorker.getCurrentSpeed(queueName);
    }

    getQueueActualSpeed(queueName: string): number {
        return this.mailingQueueWorker.getAverageProcessingSpeed(queueName, 5);
    }

    /**
     * Получить фактическую скорость обработки за последнюю секунду
     */
    getQueueLastSecondSpeed(queueName: string): number {
        return this.mailingQueueWorker.getActualProcessingSpeed(queueName);
    }

    /**
     * Получить детальную диагностику скорости очереди
     */
    getQueueSpeedDiagnostics(queueName: string): {
        currentSpeed: number;
        actualSpeed: number;
        averageSpeed: number;
        limiterSettings?: any;
    } {
        const queue = this.mailingQueueWorker.getQueueByName(queueName);
        return {
            currentSpeed: this.mailingQueueWorker.getCurrentSpeed(queueName),
            actualSpeed: this.mailingQueueWorker.getActualProcessingSpeed(queueName),
            averageSpeed: this.mailingQueueWorker.getAverageProcessingSpeed(queueName, 10),
            limiterSettings: queue ? (queue as any).opts?.limiter : undefined
        };
    }

    // Методы, связанные с обработкой и отправкой рассылок, будут перенесены сюда из MailingService
}
