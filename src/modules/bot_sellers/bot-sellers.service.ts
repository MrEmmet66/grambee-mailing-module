import { Injectable, BadRequestException, forwardRef, Inject } from '@nestjs/common';
import { CreateBotSellerDto, UpdateBotSellerDto } from './dto';
import { PrismaService } from 'prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import * as crypto from 'crypto';

@Injectable()
export class BotSellersService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => TelegramService))
    private telegramService: TelegramService
  ) {}

  // Generate unique API key
  private generateApiKey(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  // Validate bot token format
  private validateBotToken(token: string): boolean {
    // Bot tokens are usually in the format: 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi
    const botTokenRegex = /^\d+:[A-Za-z0-9_-]{35,}$/;
    return botTokenRegex.test(token);
  }

  async create(createBotSellerDto: CreateBotSellerDto) {
    // Проверяем существование пользователя
    const userExists = await this.prisma.user.findUnique({
      where: { id: createBotSellerDto.userId }
    });

    if (!userExists) {
      throw new BadRequestException(`User with id ${createBotSellerDto.userId} not found`);
    }

    // Validate bot token
    if (!this.validateBotToken(createBotSellerDto.botToken)) {
      throw new BadRequestException('Invalid bot token format. Token should match the Telegram bot token format.');
    }

    // Generate API key
    const apiKey = this.generateApiKey();

    // Create the bot seller with pending status and generated API key
    const botSeller = await this.prisma.botSeller.create({
      data: {
        ...createBotSellerDto,
        apiKey,
        acceptStatus: 'PENDING',
        usersData: createBotSellerDto.usersData || {}
      },
    });

    // Send the application to telegram for approval
    try {
      await this.telegramService.sendBotSellerApplication(botSeller);
    } catch (error) {
      console.error('Failed to send bot seller application to Telegram:', error);
      // Continue even if telegram notification fails
    }

    return botSeller;
  }

  async findAll() {
    return this.prisma.botSeller.findMany({
      include: {
        user: true,
      },
    });
  }

  async findOne(id: number) {
    return this.prisma.botSeller.findUnique({
      where: { id },
      include: {
        user: true,
        mailingReservations: true,
      },
    });
  }

  async update(id: number, updateBotSellerDto: UpdateBotSellerDto) {
    // If updating botToken, validate it
    if (updateBotSellerDto.botToken && !this.validateBotToken(updateBotSellerDto.botToken)) {
      throw new BadRequestException('Invalid bot token format. Token should match the Telegram bot token format.');
    }

    return this.prisma.botSeller.update({
      where: { id },
      data: updateBotSellerDto,
    });
  }

  async remove(id: number) {
    return this.prisma.botSeller.delete({
      where: { id },
    });
  }

  async findByUserId(userId: number) {
    return this.prisma.botSeller.findMany({
      where: { userId },
      include: {
        user: true,
      },
    });
  }

  async updateStatus(id: number, acceptStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WAITING') {
    return this.prisma.botSeller.update({
      where: { id },
      data: { acceptStatus },
    });
  }

  async updateStatistics(id: number, statistics: {
    botLiveAudience?: number;
    botMonthlyActiveUsers?: number;
    channelAudience?: number;
    channelDaylyActiveUsers?: number;
  }) {
    return this.prisma.botSeller.update({
      where: { id },
      data: statistics,
    });
  }

  // Generate new API key for an existing bot seller
  async regenerateApiKey(id: number) {
    const apiKey = this.generateApiKey();
    
    return this.prisma.botSeller.update({
      where: { id },
      data: { apiKey },
    });
  }

  // Метод для обновления категории бота
  async updateCategory(id: number, category: 'GAMBLING' | 'OTHER' | 'DATING' | 'GAMES' | 'CRYPTO' | 'FUN' | 'TECH' | 'UTILITY') {
    return this.prisma.botSeller.update({
      where: { id },
      data: { category },
    });
  }
} 