import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ description: 'ID пользователя в Telegram' })
  telegramId: string;

  @ApiProperty({ description: 'Имя пользователя в Telegram', required: false })
  username?: string;
} 