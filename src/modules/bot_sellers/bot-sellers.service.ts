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

  private generateApiKey(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private validateBotToken(token: string): boolean {
    const botTokenRegex = /^\d+:[A-Za-z0-9_-]{35,}$/;
    return botTokenRegex.test(token);
  }

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
        
        if (!trimmedLine) return;
        
        const parts = trimmedLine.split(':');
        if (parts.length !== 2) {
          isValid = false;
          rl.close();
          reject(new BadRequestException(`Invalid format at line ${lineNumber}: "${trimmedLine}". Expected format: telegram_id:lang_code`));
          return;
        }
        
        const [telegramId, langCode] = parts;
        
        if (!/^\d+$/.test(telegramId)) {
          isValid = false;
          rl.close();
          reject(new BadRequestException(`Invalid Telegram ID at line ${lineNumber}: "${telegramId}". Only numbers are allowed.`));
          return;
        }
        
        if (telegramId.length < 9 || telegramId.length > 10) {
          isValid = false;
          rl.close();
          reject(new BadRequestException(`Invalid Telegram ID length at line ${lineNumber}: "${telegramId}". ID should be 9-10 digits.`));
          return;
        }
        
        if (!/^[a-zA-Z]{1,2}$/.test(langCode)) {
          isValid = false;
          rl.close();
          reject(new BadRequestException(`Invalid language code at line ${lineNumber}: "${langCode}". Language code should be 1-2 letters.`));
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

  private async validateUser(userId: number): Promise<void> {
    const userExists = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!userExists) {
      throw new BadRequestException(`User with id ${userId} not found`);
    }
  }

  private async validateChannelAccess(botToken: string, channelId: string): Promise<void> {
    try {
      const channelInfoResponse = await axios.get(
        `https://api.telegram.org/bot${botToken}/getChat?chat_id=${channelId}`
      );
      
      if (channelInfoResponse.data && channelInfoResponse.data.ok) {
        this.logger.log('Channel Information:');
        this.logger.log(JSON.stringify(channelInfoResponse.data.result, null, 2));

        await this.validateBotAdminRights(botToken, channelId);
      } else {
        throw new BadRequestException('Invalid channel ID or bot does not have access to the channel');
      }
    } catch (error) {
      if (error.response && error.response.status === 400) {
        throw new BadRequestException('The bot is not an administrator in the specified channel. Please make the bot an administrator first.');
      }
      throw new BadRequestException('Failed to verify channel ID: ' + error.message);
    }
  }

  private async validateBotAdminRights(botToken: string, channelId: string): Promise<void> {
    try {
      const adminResponse = await axios.get(
        `https://api.telegram.org/bot${botToken}/getChatAdministrators?chat_id=${channelId}`
      );

      if (adminResponse.data && adminResponse.data.ok) {
        const administrators = adminResponse.data.result;
        const botInfo = await axios.get(
          `https://api.telegram.org/bot${botToken}/getMe`
        );

        if (botInfo.data && botInfo.data.ok) {
          const botId = botInfo.data.result.id;
          const isAdmin = administrators.some(admin => admin.user.id === botId);

          if (!isAdmin) {
            throw new BadRequestException('The bot is not an administrator in the specified channel. Please make the bot an administrator first.');
          }
        }
      } else {
        throw new BadRequestException('Failed to get channel administrators information');
      }
    } catch (error) {
      if (error.response && error.response.status === 403) {
        throw new BadRequestException('The bot is not an administrator in the specified channel. Please make the bot an administrator first.');
      }
      throw error;
    }
  }

  private async getBotInfo(botToken: string): Promise<void> {
    try {
      const botInfoResponse = await axios.get(
        `https://api.telegram.org/bot${botToken}/getMe`
      );
      
      if (botInfoResponse.data && botInfoResponse.data.ok) {
        this.logger.log('Basic Bot Information:');
        this.logger.log(JSON.stringify(botInfoResponse.data.result, null, 2));
      } else {
        this.logger.warn('Failed to get basic bot information from Telegram API');
      }
    } catch (error) {
      this.logger.error(`Error getting bot information: ${error.message}`);
    }
  }

  private async handleStatisticsFile(statisticsFile?: Express.Multer.File): Promise<string | null> {
    if (!statisticsFile) return null;

    const filePath = path.join(process.cwd(), 'uploads', 'bot_users', statisticsFile.filename);
    try {
      await this.validateStatisticsFile(filePath);
      return `/uploads/bot_users/${statisticsFile.filename}`;
    } catch (error) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error('Error deleting invalid statistics file:', e);
      }
      throw error;
    }
  }

  async create(createBotSellerDto: CreateBotSellerDto, statisticsFile?: Express.Multer.File) {
    await this.validateUser(createBotSellerDto.userId);

    if (!this.validateBotToken(createBotSellerDto.botToken)) {
      throw new BadRequestException('Invalid bot token format. Token should match the Telegram bot token format.');
    }

    if (createBotSellerDto.isChannel && !createBotSellerDto.channelId) {
      throw new BadRequestException('Channel ID is required when isChannel is true');
    }

    await this.getBotInfo(createBotSellerDto.botToken);

    if (createBotSellerDto.isChannel && createBotSellerDto.channelId) {
      await this.validateChannelAccess(createBotSellerDto.botToken, createBotSellerDto.channelId);
    }

    const mau = await this.calculateMAU(createBotSellerDto.botToken);
    this.logger.log(`[MAU] Bot ${createBotSellerDto.botToken.slice(0, 10)} has ${mau} monthly active users`);

    const apiKey = this.generateApiKey();
    const statisticsFilePath = await this.handleStatisticsFile(statisticsFile);

    const botSeller = await this.prisma.botSeller.create({
      data: {
        ...createBotSellerDto,
        apiKey,
        acceptStatus: 'PENDING',
        statisticsFilePath,
        usersData: {},
        channelId: createBotSellerDto.isChannel ? createBotSellerDto.channelId : null
      } as any,
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
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error('Error deleting invalid statistics file:', e);
      }
      throw error;
    }
  }
} 