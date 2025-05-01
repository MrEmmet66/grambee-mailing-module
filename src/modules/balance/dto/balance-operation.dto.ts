import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, Min } from 'class-validator';

export class BalanceOperationDto {
  @ApiProperty({ 
    description: 'Amount to operate with', 
    example: 100.5,
    minimum: 0.01,
    type: 'number',
    format: 'float'
  })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ 
    description: 'Description of the operation', 
    example: 'Deposit from card ending in 4242',
    type: 'string',
    minLength: 1
  })
  @IsString()
  description: string;
} 