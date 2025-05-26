import { Injectable } from "@nestjs/common";
import { PrismaService } from "prisma/prisma.service";
import { BalanceService } from "src/modules/balance/balance.service";
import { MailingTargetBots } from '@prisma/client';
import { ConfigService } from "@nestjs/config";

@Injectable()
export class MailingPaymentService {
    constructor(private readonly prisma: PrismaService, private readonly balanceService: BalanceService, private readonly configService: ConfigService) { }


    async approveMailingPayment(mailingReservationId: number) {
        const reservation = await this.prisma.mailingReservation.findUnique({
            where: { id: mailingReservationId },
            include: {
                mailing: { include: { user: true } },
                botSeller: { include: { user: true } }
            }
        });

        if (!reservation) {
            throw new Error(`Mailing reservation with ID ${mailingReservationId} not found`);
        }

        if (!reservation.isProcessed) {
            throw new Error(`Mailing reservation with ID ${mailingReservationId} is not processed yet`);
        }

        if (reservation.adminApprovalStatus === 'APPROVED' || reservation.adminApprovalStatus === 'FROZEN') {
            throw new Error(`Mailing reservation with ID ${mailingReservationId} already has an admin approval status`);
        }

        const entranceCount = reservation.peopleInvited || 0;

        const targetBot = await this.prisma.mailingTargetBots.findFirst({
            where: {
                mailingId: reservation.mailingId,
                botSellerId: reservation.botSellerId
            }
        });

        let sellerAmount = 0;
        let serviceCommission = 0;
        let totalPayment = 0;

        if (targetBot?.paymentType === 'fixed') {
            // Фиксированная оплата
            sellerAmount = reservation.botSeller.fixedPrice || 0;
            serviceCommission = this.configService.get<number>('SERVICE_COMMISSION_FIXED', 25);
            totalPayment = sellerAmount + serviceCommission;

        } else if (targetBot?.paymentType === 'perSubscriber') {
            // Оплата за подписчика - считаем по факту переходов
            const pricePerSubscriber = reservation.botSeller.subscriberPrice || 0;
            const serviceCommissionPerUser = this.configService.get<number>('SERVICE_COMMISSION_PER_USER', 0.03);

            sellerAmount = pricePerSubscriber * entranceCount;
            serviceCommission = serviceCommissionPerUser * entranceCount;
            totalPayment = sellerAmount + serviceCommission;

        } else {
            // Fallback
            sellerAmount = reservation.botSeller.fixedPrice || 0;
            serviceCommission = this.configService.get<number>('SERVICE_COMMISSION_FIXED', 25);
            totalPayment = sellerAmount + serviceCommission;
        }

        if (totalPayment <= 0) {
            throw new Error(`No payment amount calculated for reservation ${mailingReservationId}`);
        }

        try {
            // Проверить баланс покупателя (заказчика рассылки)
            const buyerBalance = await this.balanceService.getBalance(reservation.mailing.user.telegramId);

            const heldAmount = reservation.heldAmount;
            const availableHold = buyerBalance.holdBalance || 0;

            // Проверить, достаточно ли денег в холде
            if (totalPayment > heldAmount) {
                // Нужно доплатить разницу из основного баланса
                const additionalAmount = totalPayment - heldAmount;

                if ((buyerBalance.availableBalance || 0) < additionalAmount) {
                    throw new Error(`Insufficient balance. Required: ${additionalAmount}, Available: ${buyerBalance.availableBalance || 0}`);
                }

                // Снять дополнительную сумму с основного баланса
                await this.balanceService.withdrawBalance(reservation.mailing.user.telegramId, {
                    amount: additionalAmount,
                    description: `Доплата за рассылку #${reservation.mailingId} (резервация ${mailingReservationId})`
                });

                // Снять всю сумму из холда
                await this.balanceService.holdWithdrawBalance(reservation.mailing.user.telegramId, {
                    amount: heldAmount,
                    description: `Оплата за рассылку #${reservation.mailingId} (холд часть)`
                });

            } else {
                // В холде достаточно денег - снимаем только нужную сумму
                await this.balanceService.holdWithdrawBalance(reservation.mailing.user.telegramId, {
                    amount: totalPayment,
                    description: `Оплата за рассылку #${reservation.mailingId} (резервация ${mailingReservationId})`
                });

                // Освободить оставшуюся часть холда
                const unusedAmount = heldAmount - totalPayment;
                if (unusedAmount > 0) {
                    await this.balanceService.releaseBalance(reservation.mailing.user.telegramId, {
                        amount: unusedAmount,
                        description: `Возврат неиспользованной части за рассылку #${reservation.mailingId}`
                    });
                }
            }

            // Добавить деньги продавцу (только его часть, без комиссии)
            await this.balanceService.addBalance(reservation.botSeller.user.telegramId, {
                amount: sellerAmount,
                description: `Оплата за рассылку #${reservation.mailingId} от ${reservation.date.toLocaleDateString()}, переходов: ${entranceCount}`
            });

            // Обновить статус резервации
            await this.prisma.mailingReservation.update({
                where: { id: mailingReservationId },
                data: {
                    adminApprovalStatus: 'APPROVED',
                    paidAmount: totalPayment
                }
            });

            console.log(`✅ Payment approved for reservation ${mailingReservationId}:`);
            console.log(`   💰 Seller received: ${sellerAmount}`);
            console.log(`   🏢 Service commission: ${serviceCommission}`);
            console.log(`   📊 Entrances: ${entranceCount}`);
            console.log(`   💳 Total payment: ${totalPayment}`);
            console.log(`   🔒 Original hold: ${heldAmount}`);

            return {
                success: true,
                totalPayment,
                sellerAmount,
                serviceCommission,
                entranceCount,
                originalHold: heldAmount,
                additionalCharge: Math.max(0, totalPayment - heldAmount)
            };

        } catch (error) {
            console.error(`❌ Failed to approve payment for reservation ${mailingReservationId}:`, error);
            throw new Error(`Payment approval failed: ${error.message}`);
        }
    }

    async freezeMailingPayment(mailingReservationId: number, reason?: string) {
    await this.prisma.mailingReservation.update({
        where: { id: mailingReservationId },
        data: { adminApprovalStatus: 'FROZEN' }
    });
    
    return { success: true, reason: reason || 'No reason provided' };
}


}
