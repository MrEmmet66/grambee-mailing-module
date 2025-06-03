import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { GetBalanceResponseDto } from './dto/get-balance-response.dto';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { BalanceOperationDto } from './dto/balance-operation.dto';

@Injectable()
export class BalanceService {
  private readonly gatewayUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService
  ) {
    this.gatewayUrl = this.configService.get<string>('GATEWAY_URL', 'https://testgramserv.webaipay.ru');
  }

  

  private async makeBalanceRequest(endpoint: string, data: any): Promise<GetBalanceResponseDto> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.gatewayUrl}${endpoint}`, data)
      );

      if (response.data) {
        return {
          currentBalance: response.data.balance,
          holdBalance: response.data.holdBalance,
          availableBalance: response.data.availableBalance
        };
      }

      throw new BadRequestException('Failed to process balance operation');
    } catch (error) {
      if (error.response) {
        throw new BadRequestException(`Gateway error: ${error.response.data?.message || error.message}`);
      }
      throw new BadRequestException(`Failed to process balance operation: ${error.message}`);
    }
  }

  async releaseBalance(telegramId: string, dto: BalanceOperationDto): Promise<GetBalanceResponseDto> {
    return this.makeBalanceRequest(`/api/v1/balance/${telegramId}/release`, dto);
  }

  async holdWithdrawBalance(telegramId: string, dto: BalanceOperationDto): Promise<GetBalanceResponseDto> {
    return this.makeBalanceRequest(`/api/v1/balance/${telegramId}/withdraw-from-hold`, dto);
  }

  async getBalance(telegramId: string): Promise<GetBalanceResponseDto> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.gatewayUrl}/api/v1/balance/${telegramId}`)
      );

      if (response.data) {
        return {
          currentBalance: response.data.balance,
          holdBalance: response.data.holdBalance,
          availableBalance: response.data.availableBalance
        };
      }

      throw new BadRequestException('Failed to get balance from gateway');
    } catch (error) {
      if (error.response) {
        throw new BadRequestException(`Gateway error: ${error.response.data?.message || error.message}`);
      }
      throw new BadRequestException(`Failed to get balance: ${error.message}`);
    }
  }

  async addBalance(telegramId: string, dto: BalanceOperationDto): Promise<GetBalanceResponseDto> {
    return this.makeBalanceRequest(`/api/v1/balance/${telegramId}/add`, dto);
  }

  async withdrawBalance(telegramId: string, dto: BalanceOperationDto): Promise<GetBalanceResponseDto> {
    return this.makeBalanceRequest(`/api/v1/balance/${telegramId}/withdraw`, dto);
  }

  async holdBalance(telegramId: string, dto: BalanceOperationDto): Promise<GetBalanceResponseDto> {
    return this.makeBalanceRequest(`api/v1/balance/${telegramId}/hold`, dto);
  }
} 