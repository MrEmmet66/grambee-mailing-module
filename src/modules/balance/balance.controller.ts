import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { ApiTags, ApiOperation, ApiParam, ApiResponse, ApiBody } from '@nestjs/swagger';
import { GetBalanceResponseDto } from './dto/get-balance-response.dto';
import { BalanceOperationDto } from './dto/balance-operation.dto';

@ApiTags('Balance')
@Controller('api/v1/balance')
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  @Get(':telegramId')
  @ApiOperation({ 
    summary: 'Get user balance',
    description: 'Retrieves the current balance, hold balance, and available balance for the specified telegram ID'
  })
  @ApiParam({ 
    name: 'telegramId', 
    description: 'Telegram ID of the user',
    example: '123456789'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns the current balance, hold balance, and available balance',
    type: GetBalanceResponseDto
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - Invalid or missing JWT token'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'User not found'
  })
  async getBalance(
    @Param('telegramId') telegramId: string
  ): Promise<GetBalanceResponseDto> {
    return this.balanceService.getBalance(telegramId);
  }

  @Post(':telegramId/add')
  @ApiOperation({ 
    summary: 'Add balance to user account',
    description: 'Adds the specified amount to the user\'s balance and creates a deposit transaction'
  })
  @ApiParam({ 
    name: 'telegramId', 
    description: 'Telegram ID of the user',
    example: '123456789'
  })
  @ApiBody({ 
    type: BalanceOperationDto,
    description: 'Balance operation details',
    examples: {
      example1: {
        value: {
          amount: 100.5,
          description: 'Deposit from card ending in 4242'
        }
      }
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Balance added successfully',
    type: GetBalanceResponseDto
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad Request - Invalid amount or description'
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - Invalid or missing JWT token'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'User not found'
  })
  async addBalance(
    @Param('telegramId') telegramId: string,
    @Body() dto: BalanceOperationDto
  ): Promise<GetBalanceResponseDto> {
    return this.balanceService.addBalance(telegramId, dto);
  }

  @Post(':telegramId/withdraw')
  @ApiOperation({ 
    summary: 'Withdraw balance from user account',
    description: 'Withdraws the specified amount from the user\'s balance and creates a withdrawal transaction'
  })
  @ApiParam({ 
    name: 'telegramId', 
    description: 'Telegram ID of the user',
    example: '123456789'
  })
  @ApiBody({ 
    type: BalanceOperationDto,
    description: 'Balance operation details',
    examples: {
      example1: {
        value: {
          amount: 50.25,
          description: 'Withdrawal to bank account'
        }
      }
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Balance withdrawn successfully',
    type: GetBalanceResponseDto
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad Request - Invalid amount, description, or insufficient balance'
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - Invalid or missing JWT token'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'User not found'
  })
  async withdrawBalance(
    @Param('telegramId') telegramId: string,
    @Body() dto: BalanceOperationDto
  ): Promise<GetBalanceResponseDto> {
    return this.balanceService.withdrawBalance(telegramId, dto);
  }

  @Post(':telegramId/hold')
  @ApiOperation({ 
    summary: 'Hold balance in user account',
    description: 'Places a hold on the specified amount from the user\'s available balance'
  })
  @ApiParam({ 
    name: 'telegramId', 
    description: 'Telegram ID of the user',
    example: '123456789'
  })
  @ApiBody({ 
    type: BalanceOperationDto,
    description: 'Balance operation details',
    examples: {
      example1: {
        value: {
          amount: 25.75,
          description: 'Hold for purchase #12345'
        }
      }
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Balance held successfully',
    type: GetBalanceResponseDto
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad Request - Invalid amount, description, or insufficient balance'
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - Invalid or missing JWT token'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'User not found'
  })
  async holdBalance(
    @Param('telegramId') telegramId: string,
    @Body() dto: BalanceOperationDto
  ): Promise<GetBalanceResponseDto> {
    return this.balanceService.holdBalance(telegramId, dto);
  }
} 