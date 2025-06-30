import { Injectable } from '@nestjs/common';
import { TelegramService } from 'src/modules/telegram/telegram.service';
import * as Bull from 'bull';
import { ReservationService } from './reservation.service';

@Injectable()
export class MailingQueueWorker {
    private sentCounters: Record<string, number> = {};
    constructor(private readonly telegramService: TelegramService,
        private readonly mailingReservationsService: ReservationService
    ) {}

    startWorker(queueName: string, redisConfig: any, reservationId?: number) {
        const queue = new Bull(queueName, {
            redis: redisConfig,
            limiter: { max: 25, duration: 1000 },
        });
        this.sentCounters[queueName] = 0;
        queue.process(async (job) => {
            const { botToken, chatId, text, inlineKeyboard, mailing, isMedia, isChannel } = job.data;
            try {
                if (isMedia) {
                    await this.telegramService.sendMediaMessage(botToken, chatId, mailing, inlineKeyboard);
                } else {
                    await this.telegramService.sendTextMessage(botToken, chatId, text, inlineKeyboard);
                }
                if (isChannel === true) {
                    this.sentCounters[queueName]++;
                }
            } catch (e) {
                const waitMatch = e.message.match(/FLOOD_WAIT_(\d+)/i);
                if (waitMatch) {
                    const seconds = parseInt(waitMatch[1], 10) || 1;
                    await queue.add(job.data, { delay: seconds * 1000 });
                    await job.remove();
                    return;
                }
                throw e;
            }
        });
        queue.on('drained', async () => {
            // Очередь завершена, можно логировать или обработать результат
            console.log(`[MailingQueueWorker] Queue ${queueName} drained. Successfully sent: ${this.sentCounters[queueName]}`);
            // Вызовем updateReservationViews если есть reservationId
            if (reservationId) {
                try {
                    await this.mailingReservationsService.updateReservationViews(reservationId, this.sentCounters[queueName]);
                    console.log(`[MailingQueueWorker] Updated reservation ${reservationId} with views: ${this.sentCounters[queueName]}`);
                } catch (err) {
                    console.error(`[MailingQueueWorker] Failed to update reservation views:`, err);
                }
            }
        });
    }

    getSuccessfullySent(queueName: string): number {
        return this.sentCounters[queueName] || 0;
    }
}