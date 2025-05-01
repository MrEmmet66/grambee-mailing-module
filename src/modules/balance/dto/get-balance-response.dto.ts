import { ApiProperty } from '@nestjs/swagger';

export class GetBalanceResponseDto {
  @ApiProperty({ 
    description: 'Current balance of the user',
    example: 1000.5,
    type: 'number',
    format: 'float'
  })
  currentBalance: number;

  @ApiProperty({ 
    description: 'Amount of money currently on hold',
    example: 100,
    type: 'number',
    format: 'float'
  })
  holdBalance: number;

  @ApiProperty({ 
    description: 'Available balance (current balance - hold balance)',
    example: 900.5,
    type: 'number',
    format: 'float'
  })
  availableBalance: number;
} 