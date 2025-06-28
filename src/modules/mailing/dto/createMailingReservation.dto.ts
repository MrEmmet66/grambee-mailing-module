import { ApiProperty } from '@nestjs/swagger';

export enum MailingFilters {
    PREMIUM = 'premium',
    RU = 'ru',
    ENG = 'eng',
    CIS = 'cis'
}


export type CreateMailingReservationDto = {

    mailingId: number;

    sellerId: number;

    dates: Date[];

    paymentType: string;
}