export type MailingNotifyProps = {
    isChannel: boolean;
    paymentType: string;
    mailingDate: Date;
    botSellerLink: string;
    mailingLink: string;
    mailingOwnerUsername: string;
    botSellerOwnerUsername: string;
    fixedPrice: number;
    subscriberPrice: number;
    reservationId: number;
    isLastMailing?: boolean; // ✅ Добавляем флаг последней рассылки
}