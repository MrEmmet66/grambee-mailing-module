import { ApiProperty } from '@nestjs/swagger';

export class CreateBotSellerDto {
  @ApiProperty({ description: 'ID пользователя, которому принадлежит бот' })
  userId: number;

  @ApiProperty({ description: 'API ключ для доступа к боту' })
  apiKey: string;

  @ApiProperty({ description: 'Токен бота Telegram' })
  botToken: string;

  @ApiProperty({ description: 'Данные о пользователях в формате JSON' })
  usersData: any;

  @ApiProperty({ description: 'Описание бота', required: false })
  description?: string;

  @ApiProperty({ description: 'Фиксированная цена', required: false })
  fixedPrice?: number;

  @ApiProperty({ description: 'Цена за подписчика', required: false })
  subscriberPrice?: number;

  @ApiProperty({ description: 'Ссылка на бота' })
  link: string;

  @ApiProperty({ description: 'Активен ли бот', default: false, required: false })
  isActive?: boolean;

  @ApiProperty({ 
    description: 'Статус принятия бота', 
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'WAITING'],
    default: 'PENDING',
    required: false
  })
  acceptStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WAITING';

  @ApiProperty({ 
    description: 'Категория бота',
    enum: ['GAMBLING', 'OTHER', 'DATING', 'GAMES', 'CRYPTO', 'FUN', 'TECH', 'UTILITY']
  })
  category: 'GAMBLING' | 'OTHER' | 'DATING' | 'GAMES' | 'CRYPTO' | 'FUN' | 'TECH' | 'UTILITY';

  @ApiProperty({ description: 'Является ли бот каналом', default: false, required: false })
  isChannel?: boolean;
} 