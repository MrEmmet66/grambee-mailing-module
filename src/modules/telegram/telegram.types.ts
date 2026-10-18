export type MailingNotifyProps = {
    isChannel: boolean;
    paymentType: string;
    mailingDate: Date;
    botSellerLink: string;
    mailingLink: string;
    mailingOwnerUsername: string;
    botSellerOwnerUsername: string;
    fixedPrice: number;
    perSubscriberPrice: number; // цена за подписчика из конфига, не из BotSeller
    reservationId: number;
    isLastMailing?: boolean; // ✅ Добавляем флаг последней рассылки
}