import { Injectable, BadRequestException, forwardRef, Inject, Logger } from '@nestjs/common';
import { CreateBotSellerDto, UpdateBotSellerDto } from './dto';
import { PrismaService } from 'prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';

// Интерфейс для пользователя Telegram
interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface UserLanguageData {
  userId: string;
  languageCode: string | null;
}

@Injectable()
export class BotSellersService {
  private readonly logger = new Logger(BotSellersService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => TelegramService))
    private telegramService: TelegramService,
    private configService: ConfigService
  ) {
    const botUsersDir = path.join(process.cwd(), 'uploads', 'bot_users');
    if (!fs.existsSync(botUsersDir)) {
      fs.mkdirSync(botUsersDir, { recursive: true });
    }
  }

  // Generate unique API key
  private generateApiKey(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private validateBotToken(token: string): boolean {
    // Bot tokens are usually in the format: 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi
    const botTokenRegex = /^\d+:[A-Za-z0-9_-]{35,}$/;
    return botTokenRegex.test(token);
  }

  // Validate statistics file content
  private async validateStatisticsFile(filePath: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const fileStream = fs.createReadStream(filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });
      
      let lineNumber = 0;
      let isValid = true;
      
      rl.on('line', (line) => {
        lineNumber++;
        const trimmedLine = line.trim();
        
        // Пропускаем пустые строки
        if (!trimmedLine) return;
        
        // Проверяем, что строка содержит только цифры
        if (!/^\d+$/.test(trimmedLine)) {
          isValid = false;
          rl.close();
          reject(new BadRequestException(`Invalid Telegram ID at line ${lineNumber}: "${trimmedLine}". Only numbers are allowed.`));
          return;
        }
        
        // Проверяем длину Telegram ID (обычно от 9 до 10 цифр)
        // Пример: 7513657022
        if (trimmedLine.length < 9 || trimmedLine.length > 10) {
          isValid = false;
          rl.close();
          reject(new BadRequestException(`Invalid Telegram ID length at line ${lineNumber}: "${trimmedLine}". ID should be 9-10 digits.`));
          return;
        }
      });
      
      rl.on('close', () => {
        if (isValid) {
          resolve(true);
        }
      });
      
      fileStream.on('error', (err) => {
        reject(new BadRequestException(`Error reading statistics file: ${err.message}`));
      });
    });
  }

  private async calculateMAU(botToken: string): Promise<number> {
    try {
      this.logger.log(`[MAU] Starting MAU calculation for bot ${botToken.slice(0, 10)}...`);
      
      const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
      const updatesResponse = await axios.get(
        `https://api.telegram.org/bot${botToken}/getUpdates?offset=-1&limit=100&timeout=0`
      );
      
      if (updatesResponse.data && updatesResponse.data.ok) {
        const updates = updatesResponse.data.result;
        const uniqueUsers = new Set();
        
        for (const update of updates) {
          if (update.message && update.message.from) {
            uniqueUsers.add(update.message.from.id);
          }
          if (update.callback_query && update.callback_query.from) {
            uniqueUsers.add(update.callback_query.from.id);
          }
          if (update.inline_query && update.inline_query.from) {
            uniqueUsers.add(update.inline_query.from.id);
          }
        }
        
        const mau = uniqueUsers.size;
        this.logger.log(`[MAU] Calculated MAU: ${mau} unique users in the last 30 days`);
        return mau;
      }
      
      this.logger.warn(`[MAU] Failed to get updates for MAU calculation`);
      return 0;
    } catch (error) {
      this.logger.error(`[MAU] Error calculating MAU: ${error.message}`);
      return 0;
    }
  }

  async create(createBotSellerDto: CreateBotSellerDto, statisticsFile?: Express.Multer.File) {
    const userExists = await this.prisma.user.findUnique({
      where: { id: createBotSellerDto.userId }
    });

    if (!userExists) {
      throw new BadRequestException(`User with id ${createBotSellerDto.userId} not found`);
    }

    if (!this.validateBotToken(createBotSellerDto.botToken)) {
      throw new BadRequestException('Invalid bot token format. Token should match the Telegram bot token format.');
    }

    // Calculate MAU before creating the bot
    const mau = await this.calculateMAU(createBotSellerDto.botToken);
    this.logger.log(`[MAU] Bot ${createBotSellerDto.botToken.slice(0, 10)} has ${mau} monthly active users`);

    const apiKey = this.generateApiKey();

    let statisticsFilePath: string | null = null;
    
    if (statisticsFile) {
      // Validate statistics file content
      const filePath = path.join(process.cwd(), 'uploads', 'bot_users', statisticsFile.filename);
      try {
        await this.validateStatisticsFile(filePath);
        statisticsFilePath = `/uploads/bot_users/${statisticsFile.filename}`;
      } catch (error) {
        // If validation fails, delete the file
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.error('Error deleting invalid statistics file:', e);
        }
        throw error;
      }
    }

    const botSeller = await this.prisma.botSeller.create({
      data: {
        ...createBotSellerDto,
        apiKey,
        acceptStatus: 'PENDING',
        statisticsFilePath,
        usersData: {}
      },
    });

    try {
      await this.telegramService.sendBotSellerApplication(botSeller);
    } catch (error) {
      console.error('Failed to send bot seller application to Telegram:', error);
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

  async regenerateApiKey(id: number) {
    const apiKey = this.generateApiKey();
    
    return this.prisma.botSeller.update({
      where: { id },
      data: { apiKey },
    });
  }

  async updateCategory(id: number, category: 'GAMBLING' | 'OTHER' | 'DATING' | 'GAMES' | 'CRYPTO' | 'FUN' | 'TECH' | 'UTILITY') {
    return this.prisma.botSeller.update({
      where: { id },
      data: { category },
    });
  }

  async uploadStatistics(id: number, statisticsFile: Express.Multer.File) {
    const botSeller = await this.prisma.botSeller.findUnique({
      where: { id },
    });

    if (!botSeller) {
      throw new BadRequestException(`Bot seller with id ${id} not found`);
    }

    // Validate statistics file content
    const filePath = path.join(process.cwd(), 'uploads', 'bot_users', statisticsFile.filename);
    try {
      await this.validateStatisticsFile(filePath);

      if (
        botSeller.statisticsFilePath && 
        botSeller.statisticsFilePath !== `/uploads/bot_users/${statisticsFile.filename}`
      ) {
        try {
          const existingFilePath = path.join(process.cwd(), botSeller.statisticsFilePath.substring(1));
          if (fs.existsSync(existingFilePath)) {
            fs.unlinkSync(existingFilePath);
          }
        } catch (error) {
          console.error('Error deleting old statistics file:', error);
        }
      }

      const sanitizedToken = botSeller.botToken.replace(/[^a-zA-Z0-9]/g, '_');
      const newFileName = `${sanitizedToken}_statistics${path.extname(statisticsFile.filename)}`;
      const oldPath = path.join(process.cwd(), 'uploads', 'bot_users', statisticsFile.filename);
      const newPath = path.join(process.cwd(), 'uploads', 'bot_users', newFileName);

      fs.renameSync(oldPath, newPath);

      const updatedBotSeller = await this.prisma.botSeller.update({
        where: { id },
        data: {
          statisticsFilePath: `/uploads/bot_users/${newFileName}`
        },
      });

      return updatedBotSeller;
    } catch (error) {
      // If validation fails, delete the file
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error('Error deleting invalid statistics file:', e);
      }
      throw error;
    }
  }
} 