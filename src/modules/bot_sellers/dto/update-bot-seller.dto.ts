import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber, IsBoolean, IsEnum, IsDate, Matches } from 'class-validator';

export class UpdateBotSellerDto {
  @ApiProperty({ description: 'Токен бота Telegram', required: false })
  @IsString()
  @IsOptional()
  @Matches(/^\d+:[A-Za-z0-9_-]{35,}$/, {
    message: 'Bot token should match the Telegram bot token format (e.g. 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi)'
  })
  botToken?: string;

  @ApiProperty({ description: 'Данные о пользователях в формате JSON', required: false })
  @IsOptional()
  usersData?: any;

  @ApiProperty({ description: 'Описание бота', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Фиксированная цена', required: false })
  @IsNumber()
  @IsOptional()
  fixedPrice?: number;

  @ApiProperty({ description: 'Цена за подписчика', required: false })
  @IsNumber()
  @IsOptional()
  subscriberPrice?: number;

  @ApiProperty({ description: 'Ссылка на бота', required: false })
  @IsString()
  @IsOptional()
  link?: string;

  @ApiProperty({ description: 'Активен ли бот', required: false })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiProperty({ 
    description: 'Статус принятия бота', 
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'WAITING'], 
    required: false 
  })
  @IsEnum(['PENDING', 'APPROVED', 'REJECTED', 'WAITING'])
  @IsOptional()
  acceptStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WAITING';

  @ApiProperty({ 
    description: 'Категория бота',
    enum: ['GAMBLING', 'OTHER', 'DATING', 'GAMES', 'CRYPTO', 'FUN', 'TECH', 'UTILITY'],
    required: false
  })
  @IsEnum(['GAMBLING', 'OTHER', 'DATING', 'GAMES', 'CRYPTO', 'FUN', 'TECH', 'UTILITY'])
  @IsOptional()
  category?: 'GAMBLING' | 'OTHER' | 'DATING' | 'GAMES' | 'CRYPTO' | 'FUN' | 'TECH' | 'UTILITY';

  @ApiProperty({ description: 'Является ли бот каналом', required: false })
  @IsBoolean()
  @IsOptional()
  isChannel?: boolean;

  @ApiProperty({ description: 'Количество активных пользователей в боте', required: false })
  @IsNumber()
  @IsOptional()
  botLiveAudience?: number;

  @ApiProperty({ description: 'Количество активных пользователей в месяц', required: false })
  @IsNumber()
  @IsOptional()
  botMonthlyActiveUsers?: number;

  @ApiProperty({ description: 'Количество пользователей, пришедших с последней рассылки', required: false })
  @IsNumber()
  @IsOptional()
  lastMailingPeopleIncome?: number;

  @ApiProperty({ description: 'Дата последней рассылки', required: false })
  @IsDate()
  @IsOptional()
  lastMailingDate?: Date;

  @ApiProperty({ description: 'Доход с последней рассылки', required: false })
  @IsNumber()
  @IsOptional()
  lastMailingMoneyIncome?: number;

  @ApiProperty({ description: 'Аудитория канала', required: false })
  @IsNumber()
  @IsOptional()
  channelAudience?: number;

  @ApiProperty({ description: 'Количество ежедневных активных пользователей канала', required: false })
  @IsNumber()
  @IsOptional()
  channelDaylyActiveUsers?: number;

  @ApiProperty({ description: 'Ежедневный приток пользователей в канал', required: false })
  @IsNumber()
  @IsOptional()
  channelDailyPeopleIncome?: number;
} 