import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, IsOptional, IsBoolean, IsEnum, Matches, ValidateIf } from 'class-validator';
import { BotCategories } from '@prisma/client';

export class CreateBotSellerDto {
  @ApiProperty({ description: 'ID пользователя, которому принадлежит бот', required: false })
  @IsNumber()
  @IsOptional()
  @ValidateIf(o => !o.telegramId)
  userId?: number;

  @ApiProperty({ description: 'Telegram ID пользователя, которому принадлежит бот', required: false })
  @IsString()
  @IsOptional()
  @ValidateIf(o => !o.userId)
  telegramId?: string;

  @ApiProperty({ description: 'Токен бота Telegram' })
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

  @ApiProperty({ description: 'Фиксированная цена', required: true })
  @IsNumber()
  @IsOptional()
  fixedPrice?: number;


  @ApiProperty({ description: 'Ссылка на бота' })
  @IsString()
  @IsNotEmpty()
  link: string;


  @ApiProperty({ description: 'Является ли бот каналом', default: false, required: false })
  @IsOptional()
  isChannel?: string;

} 

export interface CreateBotSellerFormData {
  userId?: number;
  telegramId?: string;
  botToken: string;
  usersData?: any;
  description?: string;
  fixedPrice?: number;
  link: string;
  isChannel?: boolean;
  statisticsFile?: Express.Multer.File;
}