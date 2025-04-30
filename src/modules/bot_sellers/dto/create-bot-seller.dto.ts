import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, IsOptional, IsBoolean, IsEnum, Matches } from 'class-validator';

export class CreateBotSellerDto {
  @ApiProperty({ description: 'ID пользователя, которому принадлежит бот' })
  @IsNumber()
  @IsNotEmpty()
  userId: number;

  @ApiProperty({ description: 'Токен бота Telegram' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+:[A-Za-z0-9_-]{35,}$/, {
    message: 'Bot token should match the Telegram bot token format (e.g. 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi)'
  })
  botToken: string;

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

  @ApiProperty({ description: 'Ссылка на бота' })
  @IsString()
  @IsNotEmpty()
  link: string;

  @ApiProperty({ description: 'Активен ли бот', default: false, required: false })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiProperty({ 
    description: 'Категория бота',
    enum: ['GAMBLING', 'OTHER', 'DATING', 'GAMES', 'CRYPTO', 'FUN', 'TECH', 'UTILITY']
  })
  @IsEnum(['GAMBLING', 'OTHER', 'DATING', 'GAMES', 'CRYPTO', 'FUN', 'TECH', 'UTILITY'])
  @IsNotEmpty()
  category: 'GAMBLING' | 'OTHER' | 'DATING' | 'GAMES' | 'CRYPTO' | 'FUN' | 'TECH' | 'UTILITY';

  @ApiProperty({ description: 'Является ли бот каналом', default: false, required: false })
  @IsBoolean()
  @IsOptional()
  isChannel?: boolean;
} 