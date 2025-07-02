import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ description: 'ID пользователя в Telegram' })
  @IsNotEmpty({ message: 'telegramId is required' })
  @IsString()
  telegramId: string;

  @ApiProperty({ description: 'Имя пользователя в Telegram', required: false })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiProperty({ description: 'Пароль пользователя' })
  @IsNotEmpty({ message: 'password is required' })
  @IsString()
  password: string;
} 