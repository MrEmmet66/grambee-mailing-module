import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDate, IsIn, IsInt, Min } from 'class-validator';

export enum MailingFilters {
  PREMIUM = 'premium', RU = 'ru', ENG = 'eng', CIS = 'cis',
}

export class CreateMailingReservationDto {
  @IsInt()
  @Min(1)
  mailingId: number;

  @IsInt()
  @Min(1)
  sellerId: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(31)
  @Type(() => Date)
  @IsDate({ each: true })
  dates: Date[];

  @IsIn(['fixed', 'per_subscriber'])
  paymentType: string;
}
