export type CreateMailingReservationDto = {
    mailingId: number;
    sellerId: number;
    date: Date;
    selectedFilters: MailingFilters[];
    

}

export enum MailingFilters {
    PREMIUM = 'premium',
    RU = 'ru',
    ENG = 'eng',
    CIS = 'cis'
}