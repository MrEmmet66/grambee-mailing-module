import { Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber, IsBoolean, IsEnum, IsDate, Matches } from 'class-validator';

export class UpdateBotSellerDto {
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
  @Min(0)
  fixedPrice?: number;

  @ApiProperty({ description: 'Ссылка на бота', required: false })
  @IsString()
  @IsOptional()
  link?: string;

  @ApiProperty({ description: 'Активен ли бот', required: false })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}