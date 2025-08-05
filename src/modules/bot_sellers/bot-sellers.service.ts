import { Injectable, BadRequestException, forwardRef, Inject, Logger } from '@nestjs/common';
import { CreateBotSellerDto, CreateBotSellerFormData, UpdateBotSellerDto } from './dto';
import { PrismaService } from 'prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { BotSeller, MailingTargetBots, User } from '@prisma/client';
import { ApplicationsService } from '../telegram/applications.service';
import { log } from 'console';
import { AvatarService } from './avatar.service';

@Injectable()
export class BotSellersService {
  private readonly logger = new Logger(BotSellersService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ApplicationsService))
    private telegramService: ApplicationsService,
    private configService: ConfigService,
    private readonly avatarService: AvatarService
  ) {
    const botUsersDir = path.join(process.cwd(), 'uploads', 'bot_users');
    if (!fs.existsSync(botUsersDir)) {
      fs.mkdirSync(botUsersDir, { recursive: true });
    }
  }

  private generateApiKey(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  async getBotSellerOwnerTelegramId(botSellerId: number): Promise<string> {
    const botSeller = await this.prisma.botSeller.findUnique({
      where: { id: botSellerId },
      select: { user: { select: { telegramId: true } } }
    });

    if (!botSeller || !botSeller.user) {
      throw new BadRequestException(`Bot seller with id ${botSellerId} not found`);
    }

    return botSeller.user.telegramId;
  }

  private async getChannelDataByLink(link: string): Promise<{ title: string; channelId: string; }> {
    const botToken = this.configService.get<string>('MAIN_BOT', '');
    // Определяем тип ссылки: приватная (invite) или публичная (username)
    // Приватные обычно начинаются с https://t.me/joinchat или https://t.me/+ или имеют invite code
    const isPrivate = /^https:\/\/t\.me\/(joinchat|\+|invite)/.test(link) || /\b(joinchat|invite|\+)/.test(link);
    if (isPrivate) {
      // Приватный канал — используем userbot API
      return await this.getPrivateChannelDataByLink(link);
    } else {
      // Публичный канал — получаем username из ссылки
      // Примеры: https://t.me/username, t.me/username, @username
      let username = link;
      // Удаляем https://t.me/ и t.me/ если есть
      username = username.replace(/^https?:\/\/t\.me\//, '');
      username = username.replace(/^t\.me\//, '');
      // Удаляем @ если есть
      username = username.replace(/^@/, '');
      // Удаляем все после ? (например, параметры)
      username = username.split('?')[0];
      if (!username) {
        throw new BadRequestException('Не удалось извлечь username из публичной ссылки');
      }
      try {
        this.logger.log(`Fetching channel info for username: ${username}`);
        const response = await axios.get(`https://api.telegram.org/bot${botToken}/getChat?chat_id=@${username}`);
        if (response.data && response.data.ok && response.data.result) {
          this.logger.log(`Telegram API response for getChat: ${JSON.stringify(response.data)}`);

          return {
            title: response.data.result.title || response.data.result.username || username,
            channelId: String(response.data.result.id),
          };
        } else {
          this.logger.warn(`Telegram API returned unexpected data: ${JSON.stringify(response.data)}`);
          throw new BadRequestException('Telegram API не вернул корректную информацию о канале');
        }
      } catch (error: any) {
        this.logger.error(`Telegram API error: ${error.message}`);
        throw new BadRequestException('Не удалось получить данные о канале: ' + (error.response?.data?.description || error.message));
      }
    }
  }

  private async getPrivateChannelDataByLink(link: string): Promise<{ title: string; channelId: string; }> {
    const userBotUrl = this.configService.get<string>('USERBOT_URL', 'https://api.grambee.net/userBotApi');
    try {
      // Формируем endpoint (например, /getChannelInfo)
      const endpoint = userBotUrl.endsWith('/') ? userBotUrl + 'getChannelInfo' : userBotUrl + '/getChannelInfo';
      this.logger.debug(`Requesting userbot API: ${endpoint} with link: ${link}`);
      const response = await axios.post(endpoint, { inviteLink: link }, { timeout: 10000 });
      if (response.data && response.data.channelId && response.data.title) {
        return {
          title: response.data.title,
          channelId: response.data.channelId,
        };
      } else {
        this.logger.warn(`Userbot API returned unexpected data: ${JSON.stringify(response.data)}`);
        throw new BadRequestException('Не удалось получить данные о канале');
      }
    } catch (error: any) {
      this.logger.error(`Userbot API error: ${error.message}`);
      throw new BadRequestException('Не удалось получить данные о канале: ' + (error.response?.data?.error || error.message));
    }
  }

  async findByMailingId(mailingId: number) {
    return await this.prisma.botSeller.findMany({
      where: {
        MailingTargetBots: {
          some: {
            mailingId: mailingId,
          },
        },
      },
      include: {
        MailingTargetBots: {
          where: {
            mailingId: mailingId,
          }
        }
      },
    });
  }

  private validateBotToken(token: string): boolean {
    const botTokenRegex = /^\d+:[A-Za-z0-9_-]{35,}$/;
    return botTokenRegex.test(token);
  }

  async getBotSellerOwner(botSellerId): Promise<User> {
    const botSeller = await this.prisma.botSeller.findUnique({
      where: { id: botSellerId },
      include: { user: true }
    });

    if (!botSeller || !botSeller.user) {
      throw new BadRequestException(`Bot seller with id ${botSellerId} not found`);
    }

    return botSeller.user;
  }

  private async validateStatisticsFile(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const fileStream = fs.createReadStream(filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      let lineNumber = 0;
      let isValid = true;
      let userCount = 0;

      rl.on('line', (line) => {
        lineNumber++;
        const trimmedLine = line.trim();
        if (!trimmedLine) return;

        // Универсальный парсинг: достаем все группы цифр из строки
        const matches = trimmedLine.match(/\d{6,12}/g); // ищем все группы от 6 до 12 цифр подряд
        if (matches) {
          for (const telegramId of matches) {
            // Дополнительная проверка на длину (можно скорректировать диапазон)
            if (telegramId.length < 6 || telegramId.length > 12) {
              isValid = false;
              rl.close();
              reject(new BadRequestException(`Invalid Telegram ID length at line ${lineNumber}: "${telegramId}". ID should be 6-12 digits.`));
              return;
            }
            userCount++;
          }
        }
      });

      rl.on('close', () => {
        if (isValid) {
          resolve(userCount);
          this.logger.log(`Statistics file processed: ${filePath}, total users: ${userCount}`);
        }
      });

      fileStream.on('error', (err) => {
        reject(new BadRequestException(`Error reading statistics file: ${err.message}`));
      });
    });
  }

  async findAllPaged(page: number, limit: number, search: string, categoriesJson?: string) {
    const skip = (page - 1) * limit;
    const take = limit;
    const categories = categoriesJson ? JSON.parse(categoriesJson) : null;

    // Корректный фильтр для поиска
    const baseWhere: any = {
      acceptStatus: 'APPROVED',
      isActive: true,
    };

    let where: any = baseWhere;
    if (search && search.trim() !== '') {
      where = {
        ...baseWhere,
        OR: [
          { link: { contains: search, mode: 'insensitive' } },
          { category: { in: categories || [] } },

        ],
      };
    }

    // Получаем общее количество
    const totalCount = await this.prisma.botSeller.count({ where });
    const totalPages = Math.ceil(totalCount / limit);

    // Получаем текущую страницу
    const items = await this.prisma.botSeller.findMany({
      where,
      include: {
        user: true,
      },
      skip,
      take,
    });

    return {
      items,
      totalPages,
      totalCount,
      page,
      limit,
    };
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

  private async getUserByTelegramId(telegramId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { telegramId }
    });

    if (!user) {
      throw new BadRequestException(`User with Telegram ID ${telegramId} not found`);
    }

    return user.id;
  }

  private async validateChannelAccess(botToken: string, channelId: string): Promise<void> {
    try {
      // Skip validation completely if channelId is null or undefined
      if (!channelId) {
        return;
      }

      const channelInfoResponse = await axios.get(
        `https://api.telegram.org/bot${botToken}/getChat?chat_id=${channelId}`
      );

      if (channelInfoResponse.data && channelInfoResponse.data.ok) {
        this.logger.log('Channel Information:');
        this.logger.log(JSON.stringify(channelInfoResponse.data.result, null, 2));
        if (channelInfoResponse.data.result.has_protected_content === true) {
          throw new BadRequestException('В канале отключена пересылка сообщений. Пожалуйста, отключите эту опцию чтобы пользоваться сервисом.');
        }


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

  private async getBotInfo(botToken: string): Promise<any> {
    try {
      const botInfoResponse = await axios.get(
        `https://api.telegram.org/bot${botToken}/getMe`
      );

      if (botInfoResponse.data && botInfoResponse.data.ok) {
        this.logger.log('Basic Bot Information:');
        this.logger.log(JSON.stringify(botInfoResponse.data.result, null, 2));
        return botInfoResponse.data.result;
      } else {
        this.logger.warn('Failed to get basic bot information from Telegram API');
      }
    } catch (error) {
      this.logger.error(`Error getting bot information: ${error.message}`);
    }
  }

  private async handleStatisticsFile(statisticsFile?: Express.Multer.File): Promise<{ path: string, userCount: number } | null> {
    if (!statisticsFile) return null;

    const filePath = path.join(process.cwd(), 'uploads', 'bot_users', statisticsFile.filename);
    try {
      const userCount = await this.validateStatisticsFile(filePath);
      return { path: `/uploads/bot_users/${statisticsFile.filename}`, userCount };
    } catch (error) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error('Error deleting invalid statistics file:', e);
      }
      throw error;
    }
  }

  async create(createBotSellerDto: CreateBotSellerFormData, statisticsFile?: Express.Multer.File) {
    let userId: number = 0;

    // Debug log to see the incoming DTO
    this.logger.debug(`Creating bot seller with DTO: ${JSON.stringify(createBotSellerDto)}`);
    this.logger.debug(`isChannel type: ${typeof createBotSellerDto.isChannel}, value: ${createBotSellerDto.isChannel}`);

    const mainBotToken = this.configService.get<string>('MAIN_BOT', '');


    if (createBotSellerDto.userId) {
      userId = await this.getUserByTelegramId(String(createBotSellerDto.userId));
    }

    // проверяем botToken только если isChannel = false

    const existingBot = await this.prisma.botSeller.findFirst({
      where: {
        OR: [

          // ✅ Проверяем botToken только если он действительно передан и isChannel = false
          ...(createBotSellerDto.isChannel === false && createBotSellerDto.botToken ? [{ botToken: createBotSellerDto.botToken }] : []),
          // ✅ Проверяем link только если он действительно передан и isChannel = true
          ...(createBotSellerDto.isChannel === true && createBotSellerDto.link ? [{
            link: createBotSellerDto.link,
            isChannel: true
          }] : [])
        ]
      }
    });

    console.log(existingBot);


    if (existingBot) {
      throw new BadRequestException('A bot with this token or channel link already exists');
    }

    const isChannel = createBotSellerDto.isChannel === true;
    let avatarUrl: string | null = null;
    let channelData: { title: string; channelId: string } | null = null;
    let botInfo: any = null;
    let statistics: { path: string, userCount: number } | null = null;

    // Validate input and fill required fields
    if (isChannel) {
      if (!createBotSellerDto.link) {
        throw new BadRequestException('Channel link is required when isChannel is true');
      }
      channelData = await this.getChannelDataByLink(createBotSellerDto.link);
      const mainBotToken = this.configService.get<string>('MAIN_BOT', '');
      await this.validateChannelAccess(mainBotToken, channelData?.channelId);
      avatarUrl = await this.avatarService.getChannelAvatarUrl(mainBotToken, channelData.channelId);
      // Statistics for channel not handled here
    } else {
      if (!createBotSellerDto.botToken) {
        throw new BadRequestException('Bot token is required when isChannel is false');
      }
      if (!this.validateBotToken(createBotSellerDto.botToken)) {
        throw new BadRequestException('Invalid bot token format. Token should match the Telegram bot token format.');
      }
      botInfo = await this.getBotInfo(createBotSellerDto.botToken);
      avatarUrl = await this.avatarService.getBotAvatarUrl(createBotSellerDto.botToken);
      statistics = await this.handleStatisticsFile(statisticsFile);
      this.logger.log(`Statistics file processed: ${JSON.stringify(statistics)}`);
    }

    // Create a new object with all properties from the DTO, excluding unwanted fields
    const botSellerData = {
      ...createBotSellerDto,
      userId,
      acceptStatus: 'PENDING',
      botToken: !isChannel ? createBotSellerDto.botToken : null,
      link: isChannel ? createBotSellerDto.link : (botInfo ? `https://t.me/${botInfo.username}` : null),
      statisticsFilePath: statistics?.path || null,
      usersData: createBotSellerDto.usersData || {},
      totalBotAudience: statistics?.userCount || 0,
      isChannel,
      channelId: isChannel ? channelData?.channelId : null,
      title: isChannel ? channelData?.title : null,
      avatarUrl: avatarUrl || null,
    };

    // Remove telegramId and statisticsFile from data sent to Prisma as they're not in the BotSeller model
    if ('telegramId' in botSellerData) {
      delete botSellerData.telegramId;
    }
    if ('statisticsFile' in botSellerData) {
      delete botSellerData.statisticsFile;
    }

    this.logger.debug(`Final bot seller data: ${JSON.stringify(botSellerData)}`);

    const botSeller = await this.prisma.botSeller.create({
      data: botSellerData as any,
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

  async getAllBotSellers() {
    const now = new Date();
    
    // Получаем всех продавцов ботов с информацией о пользователях
    const botSellers = await this.prisma.botSeller.findMany({
      include: {
        user: true,
        mailingReservations: {
          where: {
            date: { gt: now }
          }
        },
        _count: {
          select: {
            mailingReservations: {
              where: { date: { gt: now } }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Получаем общий заработок по всем рассылкам каждого продавца
    const earnings = await this.prisma.mailingReservation.groupBy({
      by: ['botSellerId'],
      _sum: {
        paidAmount: true
      }
    });

    // Формируем результат с дополнительной информацией
    return botSellers.map(seller => {
      const earning = earnings.find(e => e.botSellerId === seller.id);
      return {
        ...seller,
        totalEarnings: earning?._sum.paidAmount ?? 0,
        activeMailingsCount: seller._count.mailingReservations,
        upcomingReservations: seller.mailingReservations
      };
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
    const existingBotSeller = await this.prisma.botSeller.findUnique({
      where: { id },
    });

    if (!existingBotSeller) {
      throw new BadRequestException(`Ресурс не найден`);
    }

    if (existingBotSeller.acceptStatus === 'REJECTED' || existingBotSeller.acceptStatus === 'PENDING') {
      throw new BadRequestException('Вы не можете редактировать бота, пока он не будет одобрен.');
    }



    return this.prisma.botSeller.update({
      where: { id },
      data: updateBotSellerDto,
    });
  }

  async remove(id: number) {
    const futureReservations = await this.prisma.mailingReservation.findMany({
      where: {
        botSellerId: id,
        isProcessed: false,
        date: {
          gt: new Date(),
        },
      },
    });

    if (futureReservations.length > 0) {
      throw new BadRequestException('У вашего бота забронированы рассылки, подождите, пока они закончатся.');
    }

    // Удаляем все связи с MailingTargetBots
    await this.prisma.mailingTargetBots.deleteMany({
      where: { botSellerId: id },
    });


    // Удаляем все связи с MailingReservations
    await this.prisma.mailingReservation.deleteMany({
      where: { botSellerId: id },
    });





    return this.prisma.botSeller.delete({
      where: { id },
    });
  }

  async findByUserId(telegramId: string) {
    // Сначала ищем пользователя по telegramId
    const user = await this.prisma.user.findUnique({
      where: { telegramId },
      select: { id: true }
    });

    if (!user) {
      return [];
    }

    // Затем ищем все BotSeller по userId
    return this.prisma.botSeller.findMany({
      where: { userId: user.id },
      include: {
        user: true,
      },
    });
  }



  async findByTelegramId(telegramId: string) {
    const user = await this.prisma.user.findUnique({
      where: { telegramId },
      select: { id: true }
    });

    if (!user) {
      return [];
    }

    const now = new Date();

    // Получаем всех продавцов пользователя
    const sellers = await this.prisma.botSeller.findMany({
      where: { userId: user.id },
      include: {
        user: true,
        _count: {
          select: {
            mailingReservations: {
              where: { date: { gt: now } }
            }
          }
        }
      }
    });

    // Группируем и считаем общий заработок по всем рассылкам каждого продавца
    const earnings = await this.prisma.mailingReservation.groupBy({
      by: ['botSellerId'],
      where: {
        botSellerId: { in: sellers.map(s => s.id) }
      },
      _sum: {
        paidAmount: true
      }
    });

    // Формируем результат
    const activeCounts = await this.prisma.mailingReservation.groupBy({
      by: ['botSellerId'],
      where: {
        botSellerId: { in: sellers.map(s => s.id) },
        isProcessed: false,
        date: {
          gt: now
        }
      },
      _count: {
        id: true
      }
    });

    return sellers.map(seller => {
      const earning = earnings.find(e => e.botSellerId === seller.id);
      const active = activeCounts.find(a => a.botSellerId === seller.id);
      return {
        ...seller,
        mailingReservationsCount: seller._count.mailingReservations,
        totalEarnings: earning?._sum.paidAmount ?? 0,
        activeMailingsCount: active?._count.id ?? 0
      };
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



  async updateCategory(id: number, category: 'GAMBLING' | 'OTHER' | 'DATING' | 'GAMES' | 'CRYPTO' | 'FUN' | 'TECH' | 'UTILITY') {
    return this.prisma.botSeller.update({
      where: { id },
      data: { category },
    });
  }

  async lockDay(date: Date, botSellerId: number) {
    // Проверяем, что дата не в прошлом
    const now = new Date();
    if (date < now) {
      throw new BadRequestException('Нельзя заблокировать день в прошлом');
    }

    // Проверяем, что бот-продавец существует
    const botSeller = await this.prisma.botSeller.findUnique({
      where: { id: botSellerId },
    });

    if (!botSeller) {
      throw new BadRequestException(`Bot seller with id ${botSellerId} not found`);
    }

    // Проверяем, что день не заблокирован
    const existingLock = await this.prisma.lockedDays.findFirst({
      where: {
        date: date,
        botSellerId: botSellerId,
      },
    });

    if (existingLock) {
      throw new BadRequestException(`День ${date.toISOString().split('T')[0]} уже заблокирован для этого бота`);
    }
    

    return this.prisma.lockedDays.create({
      data: {
        date,
        botSellerId,
      },
    });
  }

  async getLockedDays(botSellerId: number) {
    // Проверяем, что бот-продавец существует
    const botSeller = await this.prisma.botSeller.findUnique({
      where: { id: botSellerId },
    });

    if (!botSeller) {
      throw new BadRequestException(`Bot seller with id ${botSellerId} not found`);
    }

    return this.prisma.lockedDays.findMany({
      where: { botSellerId, date: { gte: new Date() } },
      orderBy: { date: 'asc' },
    });
  }

  async unblockDay(date: Date, botSellerId: number) {
    // Проверяем, что дата не в прошлом
    const now = new Date();
    if (date < now) {
      throw new BadRequestException('Нельзя разблокировать день в прошлом');
    }

    // Проверяем, что бот-продавец существует
    const botSeller = await this.prisma.botSeller.findUnique({
      where: { id: botSellerId },
    }); 

    if (!botSeller) {
      throw new BadRequestException(`Bot seller with id ${botSellerId} not found`);
    }

    // Проверяем, что день заблокирован
    const existingLock = await this.prisma.lockedDays.findFirst({
      where: {
        date: date,
        botSellerId: botSellerId,
      },
    });
    
    if (!existingLock) {
      throw new BadRequestException(`День ${date.toISOString().split('T')[0]} не заблокирован для этого бота`);
    }

    // Удаляем блокировку дня
    return this.prisma.lockedDays.delete({
      where: {
        id: existingLock.id,
      },
    });
  }



  async uploadStatistics(id: number, statisticsFile: Express.Multer.File) {
    const botSeller = await this.prisma.botSeller.findUnique({
      where: { id },
    });

    if (!botSeller) {
      throw new BadRequestException(`Bot seller with id ${id} not found`);
    }

    if (botSeller.isChannel === true) {
      throw new BadRequestException('Вы не можете загружать статистику для каналов. Статистика доступна только для ботов.');
    }

    const filePath = path.join(process.cwd(), 'uploads', 'bot_users', statisticsFile.filename);
    try {
      const statistics = await this.handleStatisticsFile(statisticsFile);

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

      const sanitizedToken = botSeller.botToken?.replace(/[^a-zA-Z0-9]/g, '_');
      const newFileName = `${sanitizedToken}_statistics${path.extname(statisticsFile.filename)}`;
      const oldPath = path.join(process.cwd(), 'uploads', 'bot_users', statisticsFile.filename);
      const newPath = path.join(process.cwd(), 'uploads', 'bot_users', newFileName);

      fs.renameSync(oldPath, newPath);

      const updatedBotSeller = await this.prisma.botSeller.update({
        where: { id },
        data: {
          totalBotAudience: statistics?.userCount,
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