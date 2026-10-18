import { PUBLIC_USER_SELECT } from '../../users/public-user';
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { BalanceService } from '../../balance/balance.service';
import { MailingTargetBots } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { MailingService } from './mailing.service';

@Injectable()
export class MailingPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balanceService: BalanceService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => MailingService)) // Use forwardRef to avoid circular dependency
    private readonly mailingService: MailingService,
  ) {}

  async approveMailingPayment(mailingReservationId: number) {
    const reservation = await this.prisma.mailingReservation.findUnique({
      where: { id: mailingReservationId },
      include: {
        mailing: { include: { user: { select: PUBLIC_USER_SELECT } } },
        botSeller: { include: { user: { select: PUBLIC_USER_SELECT } } },
      },
    });

    if (!reservation) {
      throw new Error(
        `Mailing reservation with ID ${mailingReservationId} not found`,
      );
    }

    if (!reservation.isProcessed) {
      throw new Error(
        `Mailing reservation with ID ${mailingReservationId} is not processed yet`,
      );
    }

    if (
      reservation.adminApprovalStatus === 'APPROVED' ||
      reservation.adminApprovalStatus === 'FROZEN'
    ) {
      throw new Error(
        `Mailing reservation with ID ${mailingReservationId} already has an admin approval status`,
      );
    }

    if (reservation.botSeller.isChannel === true) {
      await this.mailingService.updateChannelViews(reservation);
    }

    const entranceCount = reservation.viewCount || 0;

    const targetBot = await this.prisma.mailingTargetBots.findFirst({
      where: {
        mailingId: reservation.mailingId,
        botSellerId: reservation.botSellerId,
      },
    });

    const serviceDefaultSubscriberPrice = this.configService.get<number>(
      'SERVICE_DEFAULT_SUBSCRIBER_PRICE',
      0.0005,
    );
    const serviceChannelDefaultSubscriberPrice = this.configService.get<number>(
      'SERVICE_CHANNEL_DEFAULT_SUBSCRIBER_PRICE',
      0.0002,
    );

    let sellerAmount = 0;
    let serviceCommission = 0;
    let totalPayment = 0;

    // Модель оплаты зафиксирована в момент брони и хранится в MailingTargetBots.
    // Для старых записей без этой строки используем дефолт схемы ("fixed").
    const paymentType = targetBot?.paymentType ?? 'fixed';

    if (paymentType === 'fixed') {
      // Фиксированная оплата
      sellerAmount = Number(reservation.botSeller.fixedPrice) || 0;
      // Комиссия теперь процент от стоимости продавца
      const commissionPercent =
        Number(
          this.configService.get<number>('SERVICE_COMMISSION_FIXED', 10),
        ) || 0;
      serviceCommission = sellerAmount * (commissionPercent / 100);
      totalPayment = sellerAmount + serviceCommission;
    } else if (paymentType === 'per_subscriber') {
      // Оплата за подписчика - считаем по факту переходов

      const pricePerSubscriber = reservation.botSeller.isChannel
        ? Number(serviceChannelDefaultSubscriberPrice)
        : Number(serviceDefaultSubscriberPrice);
      const serviceCommissionPerUser =
        Number(
          this.configService.get<number>(
            'SERVICE_COMMISSION_PER_USER',
            0.00005,
          ),
        ) || 0;

      sellerAmount = pricePerSubscriber * entranceCount;
      serviceCommission = serviceCommissionPerUser * entranceCount;
      totalPayment = sellerAmount + serviceCommission;
    } else {
      // Неизвестная модель оплаты: молча заплатить по фиксу опаснее, чем упасть.
      throw new Error(
        `Unsupported payment type "${paymentType}" for reservation ${mailingReservationId}`,
      );
    }

    if (totalPayment <= 0) {
      throw new Error(
        `No payment amount calculated for reservation ${mailingReservationId}`,
      );
    }

    try {
      // Проверить баланс покупателя (заказчика рассылки)
      const buyerBalance = await this.balanceService.getBalance(
        reservation.mailing.user.telegramId,
      );

      const heldAmount = reservation.heldAmount;
      const availableHold = buyerBalance.holdBalance || 0;

      // Проверить, достаточно ли денег в холде
      if (totalPayment > heldAmount) {
        // Нужно доплатить разницу из основного баланса
        const additionalAmount = totalPayment - heldAmount;
        console.log(
          `🔍 Insufficient hold amount. Total payment: ${totalPayment}, Held amount: ${heldAmount}, Additional amount needed: ${additionalAmount}`,
        );

        if ((buyerBalance.availableBalance || 0) < additionalAmount) {
          throw new Error(
            `Insufficient balance. Required: ${additionalAmount}, Available: ${buyerBalance.availableBalance || 0}`,
          );
        }

        // Снять дополнительную сумму с основного баланса
        await this.balanceService.withdrawBalance(
          reservation.mailing.user.telegramId,
          {
            amount: additionalAmount,
            description: `Доплата за рассылку #${reservation.mailingId} (резервация ${mailingReservationId})`,
          },
        );

        // Снять всю сумму из холда
        await this.balanceService.holdWithdrawBalance(
          reservation.mailing.user.telegramId,
          {
            amount: heldAmount,
            description: `Оплата за рассылку #${reservation.mailingId} (холд часть)`,
          },
        );
      } else {
        // В холде достаточно денег - снимаем только нужную сумму
        await this.balanceService.holdWithdrawBalance(
          reservation.mailing.user.telegramId,
          {
            amount: totalPayment,
            description: `Оплата за рассылку #${reservation.mailingId} (резервация ${mailingReservationId})`,
          },
        );

        // Освободить оставшуюся часть холда
        const unusedAmount = heldAmount - totalPayment;
        if (unusedAmount > 0) {
          await this.balanceService.releaseBalance(
            reservation.mailing.user.telegramId,
            {
              amount: unusedAmount,
              description: `Возврат неиспользованной части за рассылку #${reservation.mailingId}`,
            },
          );
        }
      }

      // Добавить деньги продавцу (только его часть, без комиссии)
      await this.balanceService.addBalance(
        reservation.botSeller.user.telegramId,
        {
          amount: sellerAmount,
          description: `Оплата за рассылку #${reservation.mailingId} от ${reservation.date.toLocaleDateString()}, переходов: ${entranceCount}`,
        },
      );

      // Обновить статус резервации
      await this.prisma.mailingReservation.update({
        where: { id: mailingReservationId },
        data: {
          adminApprovalStatus: 'APPROVED',
          paidAmount: totalPayment,
        },
      });

      console.log(
        `✅ Payment approved for reservation ${mailingReservationId}:`,
      );
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
        additionalCharge: Math.max(0, totalPayment - heldAmount),
      };
    } catch (error) {
      console.error(
        `❌ Failed to approve payment for reservation ${mailingReservationId}:`,
        error,
      );
      throw new Error(`Payment approval failed: ${error.message}`);
    }
  }

  async freezeMailingPayment(mailingReservationId: number, reason?: string) {
    await this.prisma.mailingReservation.update({
      where: { id: mailingReservationId },
      data: { adminApprovalStatus: 'FROZEN' },
    });

    return { success: true, reason: reason || 'No reason provided' };
  }
}
