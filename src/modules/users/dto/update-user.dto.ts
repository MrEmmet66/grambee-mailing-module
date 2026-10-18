import { ApiProperty } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiProperty({ description: 'ID пользователя в Telegram', required: false })
  telegramId?: string;

  @ApiProperty({ description: 'Имя пользователя в Telegram', required: false })
  username?: string;
}
