import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsBoolean } from 'class-validator';

export class RegisterDto {
  @ApiProperty({
    description: 'Telegram user ID',
    example: '123456789'
  })
  @IsString()
  @IsNotEmpty()
  telegramId: string;

  @ApiPropertyOptional({
    description: 'Telegram username',
    example: 'johndoe'
  })
  @IsString()
  @IsOptional()
  username?: string;

  @ApiProperty({
    description: 'First name',
    example: 'John'
  })
  @IsString()
  firstName: string;

  @ApiPropertyOptional({
    description: 'Last name',
    example: 'Doe'
  })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiPropertyOptional({
    description: 'Language code',
    example: 'en'
  })
  @IsString()
  @IsOptional()
  languageCode?: string;

  @ApiPropertyOptional({
    description: 'Avatar URL',
    example: 'https://example.com/avatar.jpg'
  })
  @IsString()
  @IsOptional()
  avatarUrl?: string;

  @ApiPropertyOptional({
    description: 'Is user a bot',
    example: false
  })
  @IsBoolean()
  @IsOptional()
  isBot?: boolean;

  @ApiPropertyOptional({
    description: 'Referral code',
    example: 'ABC123'
  })
  @IsString()
  @IsOptional()
  referralCode?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  passwordHash?: string;

}