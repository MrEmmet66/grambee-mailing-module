import { Injectable, Logger, NotFoundException, ConflictException, PreconditionFailedException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { BalanceService } from '../../balance/balance.service';
import { TelegramService } from '../../telegram/telegram.service';
import { CreateMailingReservationDto } from '../dto/createMailingReservation.dto';
import { ReservationCancellationResult, ReservationCreationResult } from '../types/reservation.types';
import { MailingReservation } from '@prisma/client';

@Injectable()
export class ReservationService {
    private readonly logger = new Logger(ReservationService.name);

    constructor(
        private readonly prismaService: PrismaService,
        private readonly configService: ConfigService,
        private readonly balanceService: BalanceService,
        @Inject(forwardRef(() => TelegramService))
        private readonly telegramService: TelegramService,
    ) { }

    async getMailingsByDate(date: Date, sellerId: string) {
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

    async getMailingReservations(mailingId: number) {
        const mailing = await this.prismaService.mailingReservation.findMany({
            where: { mailingId: mailingId, isProcessed: false, adminApprovalStatus: { not: 'FROZEN' } },
            orderBy: {
                date: 'asc'
            }
        });

        if (!mailing) {
            throw new NotFoundException(`Mailing with ID ${mailingId} not found`);
        }

        return mailing;
    } async removeMailingReservation(reservationId: number): Promise<ReservationCancellationResult> {
        const reservation = await this.prismaService.mailingReservation.findUnique({
            where: { id: reservationId },
            include: {
                mailing: {
                    include: {
                        user: true
                    }
                },
                botSeller: {
                    include: {
                        user: true
                    }
                }
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
        }        // Check 48-hour rule
        const now = new Date();
        const reservationDate = new Date(reservation.date);
        const hoursUntilReservation = (reservationDate.getTime() - now.getTime()) / (1000 * 60 * 60);

        this.logger.log(`Checking cancellation for reservation ${reservationId}: ${hoursUntilReservation.toFixed(2)} hours until reservation date`);

        if (hoursUntilReservation < 48) {
            throw new ConflictException(`Cannot cancel reservation less than 48 hours before the scheduled date. Only ${hoursUntilReservation.toFixed(2)} hours remaining.`);
        }

        // Calculate refund amounts
        const totalHeldAmount = reservation.heldAmount;
        const buyerRefundAmount = totalHeldAmount * 0.7; // 70% to buyer
        const sellerCompensationAmount = totalHeldAmount * 0.25; // 25% to seller
        // Remaining 5% stays as cancellation fee

        const buyerTelegramId = reservation.mailing.user.telegramId;
        const sellerTelegramId = reservation.botSeller.user.telegramId; try {
            // Release 70% from hold and return to buyer
            await this.balanceService.releaseBalance(buyerTelegramId, {
                amount: Number(buyerRefundAmount.toFixed(2)),
                description: `Возврат 70% за отмену резервации рассылки #${reservation.mailingId}. Резервация #${reservationId}.`
            });

            // Withdraw remaining 25% from hold and add to seller
            await this.balanceService.holdWithdrawBalance(buyerTelegramId, {
                amount: Number(sellerCompensationAmount.toFixed(2)),
                description: `Списание 25% за отмену резервации рассылки #${reservation.mailingId}. Резервация #${reservationId}.`
            });

            // Add compensation to seller
            await this.balanceService.addBalance(sellerTelegramId, {
                amount: Number(sellerCompensationAmount.toFixed(2)),
                description: `Компенсация 25% за отмену резервации рассылки #${reservation.mailingId}. Резервация #${reservationId}.`
            });

            // Withdraw remaining 5% as cancellation fee (from hold)
            const cancellationFee = totalHeldAmount - buyerRefundAmount - sellerCompensationAmount;
            if (cancellationFee > 0) {
                await this.balanceService.holdWithdrawBalance(buyerTelegramId, {
                    amount: Number(cancellationFee.toFixed(2)),
                    description: `Комиссия за отмену резервации 5%. Резервация #${reservationId}.`
                });
            }

            this.logger.log(`Processed reservation cancellation: Buyer refund: ${buyerRefundAmount}, Seller compensation: ${sellerCompensationAmount}, Cancellation fee: ${cancellationFee}`);

        } catch (error) {
            this.logger.error(`Failed to process refund for reservation ${reservationId}: ${error.message}`);
            throw new PreconditionFailedException(`Failed to process refund: ${error.message}`);
        }

        // Delete the reservation
        const deletedReservation = await this.prismaService.mailingReservation.delete({
            where: { id: reservationId }
        });

        return {
            reservation: deletedReservation,
            refundDetails: {
                totalHeldAmount,
                buyerRefundAmount,
                sellerCompensationAmount,
                cancellationFee: totalHeldAmount - buyerRefundAmount - sellerCompensationAmount,
                buyerTelegramId,
                sellerTelegramId
            }
        };
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

    async checkAndDeactivateMailing(mailingId: number) {
        const remainingReservations = await this.prismaService.mailingReservation.count({
            where: {
                mailingId: mailingId,
                isProcessed: false,
                adminApprovalStatus: 'APPROVED'
            }
        });

        if (remainingReservations === 0) {
            const updatedMailing = await this.prismaService.mailing.update({
                where: { id: mailingId },
                data: {
                    isActive: false,
                    status: 'COMPLETED'
                }
            });

            this.logger.log(`Mailing ${mailingId} completed and deactivated`);
            return updatedMailing;
        }

        return null;
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

    async reserveMailingDay(dto: CreateMailingReservationDto): Promise<ReservationCreationResult> {
        if (!Array.isArray(dto.dates) || dto.dates.length === 0) {
            throw new PreconditionFailedException('No dates provided for reservation');
        }

        const botSeller = await this.prismaService.botSeller.findUnique({
            where: { id: dto.sellerId }
        });
        if (!botSeller) {
            throw new NotFoundException('Bot seller not found');
        }

        const mailing = await this.prismaService.mailing.findUnique({
            where: { id: dto.mailingId }
        });
        if (!mailing) {
            throw new NotFoundException('Mailing not found');
        }

        // Получаем комиссии сервиса из конфига
        const serviceCommissionFixed = this.configService.get<number>('SERVICE_COMMISSION_FIXED', 25);
        const serviceCommissionPerUser = this.configService.get<number>('SERVICE_COMMISSION_PER_USER', 0.03);

        // Получаем пользователя из мейлинга для холда баланса
        const user = await this.prismaService.user.findUnique({
            where: { id: mailing.userId }
        });
        if (!user) {
            throw new NotFoundException('User not found');
        }

        const reservations: MailingReservation[] = [];
        for (const date of dto.dates) {
            // Проверка на прошлое
            if (date < new Date()) {
                throw new PreconditionFailedException(`Cannot reserve past date: ${date}`);
            }
            // Проверка на уникальность
            const existingReservation = await this.prismaService.mailingReservation.findFirst({
                where: {
                    date: date,
                    botSellerId: dto.sellerId,
                }
            });
            if (existingReservation) {
                throw new ConflictException(`Mailing day already reserved: ${date}`);
            }

            // Расчет стоимости и комиссии
            let heldAmount = 0;
            let baseAmount = 0;
            let serviceCommission = 0;
            if (dto.paymentType === 'fixed') {
                baseAmount = botSeller.fixedPrice || 0;
                serviceCommission = serviceCommissionFixed;
                heldAmount = baseAmount + serviceCommission;
            } else if (dto.paymentType === 'subscriber') {
                if (mailing.botToken === null) {
                    throw new PreconditionFailedException('Bot token is required for subscriber payment type');
                }
                if (mailing.isChannel && mailing.channelId !== null) {
                    const maxUsers = botSeller.channelAudience || 0;
                    if (maxUsers <= 0) {
                        throw new PreconditionFailedException('Channel audience data is required for subscriber payment');
                    } else {
                        baseAmount = (botSeller.subscriberPrice || 0) * maxUsers;
                        serviceCommission = serviceCommissionPerUser * maxUsers;
                    }
                } else {
                    const maxUsers = botSeller.botLiveAudience || 0;
                    if (maxUsers <= 0) {
                        throw new PreconditionFailedException('Bot audience data is required for subscriber payment');
                    } else {
                        baseAmount = (botSeller.subscriberPrice || 0) * maxUsers;
                        serviceCommission = serviceCommissionPerUser * maxUsers;
                    }
                }
                heldAmount = baseAmount + serviceCommission;
            } else {
                baseAmount = botSeller.fixedPrice || 0;
                serviceCommission = serviceCommissionFixed;
                heldAmount = baseAmount + serviceCommission;
            }

            // Холдим баланс для каждой даты
            try {
                this.logger.log(`Holding balance for mailing reservation: ${heldAmount} (date: ${date})`);
                await this.balanceService.holdBalance(user.telegramId.toString(), {
                    amount: Number(heldAmount.toFixed(2)),
                    description: `Удержание баланса за резервирование рассылки #${dto.mailingId} для канала ${botSeller.link} на дату ${date}. Базовая стоимость: ${baseAmount}, комиссия сервиса: ${serviceCommission}.`
                });
            } catch (error) {
                this.logger.error(`Failed to hold balance for mailing reservation (date: ${date}): ${error.message}`);
                throw new PreconditionFailedException(`Не удалось зарезервировать средства на дату ${date}: ${error.message}`);
            }

            // Генерируем trackingLink для каждой даты
            const trackingLink = await this.telegramService.generateTrackingLink(
                mailing.isChannel,
                mailing.channelId,
                dto.mailingId,
                dto.sellerId,
                mailing.botLink || '',
                mailing.botToken || botSeller.botToken
            );

            const reservation = await this.prismaService.mailingReservation.create({
                data: {
                    mailingId: Number(dto.mailingId),
                    botSellerId: Number(dto.sellerId),
                    date: date,
                    selectedFilters: {}, // или null, если поле допускает null
                    heldAmount: parseFloat(heldAmount.toString()),
                    trackingLink: trackingLink
                }
            });
            reservations.push(reservation);
        }

        // Check if this is the first reservation for this bot-mailing combination
        const existingTargetBot = await this.prismaService.mailingTargetBots.findFirst({
            where: {
                botSellerId: dto.sellerId,
                mailingId: dto.mailingId,
                paymentType: dto.paymentType || 'fixed'
            }
        });
        if (!existingTargetBot && reservations.length > 0) {
            await this.prismaService.mailingTargetBots.create({
                data: {
                    botSellerId: dto.sellerId,
                    mailingId: dto.mailingId,
                    link: reservations[0].trackingLink || '',
                    paymentType: dto.paymentType || 'fixed',
                }
            });
        }

        return { reservations, seller: botSeller };
    }

    async canCancelReservation(reservationId: number): Promise<{
        canCancel: boolean;
        reason?: string;
        hoursUntilReservation?: number;
        refundPreview?: {
            totalHeldAmount: number;
            buyerRefundAmount: number;
            sellerCompensationAmount: number;
            cancellationFee: number;
        };
    }> {
        const reservation = await this.prismaService.mailingReservation.findUnique({
            where: { id: reservationId },
            include: {
                mailing: true
            }
        });

        if (!reservation) {
            return {
                canCancel: false,
                reason: 'Reservation not found'
            };
        }

        if (reservation.isProcessed) {
            return {
                canCancel: false,
                reason: 'Reservation is already processed'
            };
        }

        if (reservation.adminApprovalStatus === 'FROZEN') {
            return {
                canCancel: false,
                reason: 'Reservation is frozen'
            };
        }

        if (reservation.mailing.isActive) {
            return {
                canCancel: false,
                reason: 'Mailing is active and cannot be cancelled'
            };
        }

        const now = new Date();
        const reservationDate = new Date(reservation.date);
        const hoursUntilReservation = (reservationDate.getTime() - now.getTime()) / (1000 * 60 * 60);

        if (hoursUntilReservation < 48) {
            return {
                canCancel: false,
                reason: `Cannot cancel reservation less than 48 hours before the scheduled date. Only ${hoursUntilReservation.toFixed(2)} hours remaining.`,
                hoursUntilReservation
            };
        }

        // Calculate refund preview
        const totalHeldAmount = reservation.heldAmount;
        const buyerRefundAmount = totalHeldAmount * 0.7;
        const sellerCompensationAmount = totalHeldAmount * 0.25;
        const cancellationFee = totalHeldAmount - buyerRefundAmount - sellerCompensationAmount;

        return {
            canCancel: true,
            hoursUntilReservation,
            refundPreview: {
                totalHeldAmount,
                buyerRefundAmount,
                sellerCompensationAmount,
                cancellationFee
            }
        };
    }
}
