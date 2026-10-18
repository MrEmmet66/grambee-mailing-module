import {
  IsInt,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[1-9]\d{0,19}$/)
  telegramId: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}
export class RefreshTokenDto {
  @ApiProperty({ description: 'Internal user ID returned by registration' })
  @IsInt()
  @Min(1)
  userId: number;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  refreshToken: string;
}
