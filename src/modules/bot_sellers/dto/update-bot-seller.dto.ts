import { ApiProperty } from '@nestjs/swagger';

export class UpdateBotSellerDto {
  @ApiProperty({ description: 'API ключ для доступа к боту', required: false })
  apiKey?: string;

  @ApiProperty({ description: 'Токен бота Telegram', required: false })
  botToken?: string;

  @ApiProperty({ description: 'Данные о пользователях в формате JSON', required: false })
  usersData?: any;

  @ApiProperty({ description: 'Описание бота', required: false })
  description?: string;

  @ApiProperty({ description: 'Фиксированная цена', required: false })
  fixedPrice?: number;

  @ApiProperty({ description: 'Цена за подписчика', required: false })
  subscriberPrice?: number;

  @ApiProperty({ description: 'Ссылка на бота', required: false })
  link?: string;

  @ApiProperty({ description: 'Активен ли бот', required: false })
  isActive?: boolean;

  @ApiProperty({ 
    description: 'Статус принятия бота', 
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'WAITING'], 
    required: false 
  })
  acceptStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WAITING';

  @ApiProperty({ 
    description: 'Категория бота',
    enum: ['GAMBLING', 'OTHER', 'DATING', 'GAMES', 'CRYPTO', 'FUN', 'TECH', 'UTILITY'],
    required: false
  })
  category?: 'GAMBLING' | 'OTHER' | 'DATING' | 'GAMES' | 'CRYPTO' | 'FUN' | 'TECH' | 'UTILITY';

  @ApiProperty({ description: 'Является ли бот каналом', required: false })
  isChannel?: boolean;

  @ApiProperty({ description: 'Количество активных пользователей в боте', required: false })
  botLiveAudience?: number;

  @ApiProperty({ description: 'Количество активных пользователей в месяц', required: false })
  botMonthlyActiveUsers?: number;

  @ApiProperty({ description: 'Количество пользователей, пришедших с последней рассылки', required: false })
  lastMailingPeopleIncome?: number;

  @ApiProperty({ description: 'Дата последней рассылки', required: false })
  lastMailingDate?: Date;

  @ApiProperty({ description: 'Доход с последней рассылки', required: false })
  lastMailingMoneyIncome?: number;

  @ApiProperty({ description: 'Аудитория канала', required: false })
  channelAudience?: number;

  @ApiProperty({ description: 'Количество ежедневных активных пользователей канала', required: false })
  channelDaylyActiveUsers?: number;

  @ApiProperty({ description: 'Ежедневный приток пользователей в канал', required: false })
  channelDailyPeopleIncome?: number;
} 