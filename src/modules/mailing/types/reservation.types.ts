import { MailingReservation } from "@prisma/client";

export interface ReservationCancellationResult {
    reservation: any; // MailingReservation from Prisma
    refundDetails: {
        totalHeldAmount: number;
        buyerRefundAmount: number;
        sellerCompensationAmount: number;
        cancellationFee: number;
        buyerTelegramId: string;
        sellerTelegramId: string;
    };
}

export interface ReservationCreationResult {
    reservations: MailingReservation[]; // MailingReservation from Prisma
    seller: any; // BotSeller from Prisma
}
