import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseInterceptors, UploadedFile, UseGuards, BadRequestException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { BotSellersService } from './bot-sellers.service';
import { CreateBotSellerDto, CreateBotSellerFormData, UpdateBotSellerDto } from './dto';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiResponse, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DateManagementDto } from './dto/date-managent.dto';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Bot Sellers')
@Controller('bot-sellers')
// @UseGuards(JwtAuthGuard)
export class BotSellersController {

  private isProd: boolean;

  constructor(private readonly botSellersService: BotSellersService,
    private readonly configService: ConfigService
  ) {
    const env = this.configService.get<string>('ENVIRONMENT') ?? process.env.ENVIRONMENT;
    this.isProd = env === 'production' || env === 'prod';
  }

  @Post()
  @ApiOperation({ summary: 'Создание нового продавца ботов' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreateBotSellerDto })
  @ApiResponse({ status: 201, description: 'Продавец бота успешно создан' })
  @UseInterceptors(
    FileInterceptor('statisticsFile', {
      storage: diskStorage({
        destination: './uploads/bot_users',
        filename: (req, file, callback) => {
          console.log('FileInterceptor received file:', file.originalname);

          const botToken = req.body.botToken;
          const sanitizedToken = botToken ? botToken.replace(/[^a-zA-Z0-9]/g, '_') : '';
          const fileName = `${sanitizedToken}_statistics${extname(file.originalname)}`;
          callback(null, fileName);
        },
      }),
      fileFilter: (req, file, callback) => {
        if (file.mimetype !== 'text/plain' && !file.originalname.toLowerCase().endsWith('.txt')) {
          return callback(new Error('Только .txt файлы разрешены'), false);
        }
        callback(null, true);
      },
      limits: {
        fileSize: 20 * 1024 * 1024,
      }
    }),
  )
  create(
    @Body() createBotSellerDto: CreateBotSellerDto,
    @UploadedFile() statisticsFile?: Express.Multer.File,
  ) {
    // Handle the uploaded file if it exists
    if (statisticsFile) {
      console.log('Controller received statisticsFile:', statisticsFile.originalname);
    }
    if (createBotSellerDto.isChannel === 'false' && !statisticsFile) {
      throw new BadRequestException('Для каналов ботов требуется загрузить файл статистики пользователей.');
    }
    console.log('Controller received createBotSellerDto:', createBotSellerDto);
    const mainBotToken = this.configService.get<string>('MAIN_BOT', '');

    if (createBotSellerDto.isChannel === 'true') {
      createBotSellerDto.botToken = mainBotToken;
    }

    const botSellerData: CreateBotSellerFormData = {
      userId: createBotSellerDto.userId,
      telegramId: createBotSellerDto.telegramId,
      botToken: createBotSellerDto.botToken || null,
      usersData: createBotSellerDto.usersData,
      description: createBotSellerDto.description,
      fixedPrice: createBotSellerDto.fixedPrice,
      link: createBotSellerDto.link,
      isChannel: String(createBotSellerDto.isChannel).toLowerCase() === 'true',
      statisticsFile: statisticsFile ? statisticsFile : undefined,
    }
    console.log('statisticsFile:', statisticsFile);


    console.log('Controller received isChannel:', createBotSellerDto.isChannel);

    return this.botSellersService.create(botSellerData, statisticsFile);
  }

  @Get()
  @ApiOperation({ summary: 'Получение всех продавцов ботов' })
  @ApiResponse({ status: 200, description: 'Список всех продавцов ботов' })
  findAll() {
    return this.botSellersService.findAll();
  }

  @Get('/all')
  @ApiOperation({ summary: 'Получение всех продавцов ботов с детальной информацией' })
  @ApiResponse({
    status: 200,
    description: 'Список всех продавцов ботов с полной информацией',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          userId: { type: 'number' },
          botToken: { type: 'string', nullable: true },
          link: { type: 'string', nullable: true },
          description: { type: 'string', nullable: true },
          fixedPrice: { type: 'number', nullable: true },
          usersData: { type: 'object' },
          acceptStatus: {
            type: 'string',
            enum: ['PENDING', 'APPROVED', 'REJECTED', 'WAITING']
          },
          isActive: { type: 'boolean' },
          isChannel: { type: 'boolean' },
          category: {
            type: 'string',
            enum: ['GAMBLING', 'OTHER', 'DATING', 'GAMES', 'CRYPTO', 'FUN', 'TECH', 'UTILITY']
          },
          statisticsFilePath: { type: 'string', nullable: true },
          totalBotAudience: { type: 'number' },
          botLiveAudience: { type: 'number', nullable: true },
          botMonthlyActiveUsers: { type: 'number', nullable: true },
          channelAudience: { type: 'number', nullable: true },
          channelDaylyActiveUsers: { type: 'number', nullable: true },
          channelId: { type: 'string', nullable: true },
          title: { type: 'string', nullable: true },
          avatarUrl: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          user: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              telegramId: { type: 'string' },
              username: { type: 'string', nullable: true },
              firstName: { type: 'string', nullable: true },
              lastName: { type: 'string', nullable: true },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' }
            }
          }
        }
      }
    }
  })
  getAllBotSellers() {
    return this.botSellersService.getAllBotSellers();
  }

  @Get('/dates/locked/:sellerId')
  async getLockedDates(@Param('sellerId') sellerId: number) {
    return this.botSellersService.getLockedDays(sellerId);
  }

  @Post('/date')
  async manageDate(
    @Body() dateManagementDto: DateManagementDto,
    @CurrentUser() user?: AuthUser
  ) {
    if (this.isProd) {
      if (!user) {
        throw new UnauthorizedException('Требуется авторизация.');
      }
      if (!(await this.botSellersService.isUserOwningBot(user.telegramId, dateManagementDto.botSellerId))) {
        throw new ForbiddenException('У вас нет прав на изменение этого бота.');
      }
    }

    return dateManagementDto.isLocked ? this.botSellersService.lockDay(dateManagementDto.date, dateManagementDto.botSellerId) : this.botSellersService.unblockDay(dateManagementDto.date, dateManagementDto.botSellerId);
  }

  @Get('/paged')
  @ApiOperation({ summary: 'Получение продавцов ботов с пагинацией' })
  @ApiResponse({ status: 200, description: 'Список продавцов ботов с пагинацией' })
  findAllPaged(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('search') search: string = '',
    @Query('category') categories?: string
  ) {
    return this.botSellersService.findAllPaged(page, limit, search, categories);
  }


  @Get('mailing/:mailingId')
  @ApiOperation({ summary: 'Получение продавцов ботов по ID рассылки' })
  @ApiParam({ name: 'mailingId', description: 'ID рассылки' })
  @ApiResponse({ status: 200, description: 'Список продавцов ботов для данной рассылки' })
  findByMailingId(@Param('mailingId') mailingId: number) {
    return this.botSellersService.findByMailingId(mailingId);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Получение продавцов ботов по ID пользователя' })
  @ApiParam({ name: 'userId', description: 'ID пользователя' })
  @ApiResponse({ status: 200, description: 'Список продавцов ботов пользователя' })
  findByUserId(@Param('userId') userId: string) {
    return this.botSellersService.findByUserId(userId);
  }

  @Get('telegram/:telegramId')
  @ApiOperation({ summary: 'Получение продавцов ботов по Telegram ID пользователя' })
  @ApiParam({ name: 'telegramId', description: 'Telegram ID пользователя' })
  @ApiResponse({ status: 200, description: 'Список продавцов ботов пользователя' })
  findByTelegramId(@Param('telegramId') telegramId: string) {
    return this.botSellersService.findByTelegramId(telegramId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получение продавца бота по ID' })
  @ApiParam({ name: 'id', description: 'ID продавца бота' })
  @ApiResponse({ status: 200, description: 'Данные о продавце бота' })
  findOne(@Param('id') id: string) {
    return this.botSellersService.findOne(+id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновление данных продавца бота' })
  @ApiParam({ name: 'id', description: 'ID продавца бота' })
  @ApiBody({ type: UpdateBotSellerDto })
  @ApiResponse({ status: 200, description: 'Данные продавца бота обновлены' })
  async update(@Param('id') id: string, @Body() updateBotSellerDto: UpdateBotSellerDto, @CurrentUser() user?: AuthUser) {

    if (this.isProd) {
      if (!user) {
        throw new UnauthorizedException('Требуется авторизация.');
      }
      if (!(await this.botSellersService.isUserOwningBot(user.telegramId, +id))) {
        throw new ForbiddenException('У вас нет прав на изменение этого бота.');
      }
    }

    return this.botSellersService.update(+id, updateBotSellerDto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Обновление статуса продавца бота' })
  @ApiParam({ name: 'id', description: 'ID продавца бота' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['PENDING', 'APPROVED', 'REJECTED', 'WAITING'],
          description: 'Новый статус продавца бота'
        }
      }
    }
  })
  @ApiResponse({ status: 200, description: 'Статус продавца бота обновлен' })
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WAITING',
    @CurrentUser() user?: AuthUser
  ) {
    if (this.isProd) {
      if (!user) {
        throw new UnauthorizedException('Требуется авторизация.');
      }
      if (!(await this.botSellersService.isUserOwningBot(user.telegramId, +id))) {
        throw new ForbiddenException('У вас нет прав на изменение этого бота.');
      }
    }

    return this.botSellersService.updateStatus(+id, status);
  }

  @Patch(':id/statistics')
  @ApiOperation({ summary: 'Обновление статистики продавца бота' })
  @ApiParam({ name: 'id', description: 'ID продавца бота' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        botLiveAudience: {
          type: 'number',
          description: 'Количество активных пользователей в боте'
        },
        botMonthlyActiveUsers: {
          type: 'number',
          description: 'Количество активных пользователей в месяц'
        },
        channelAudience: {
          type: 'number',
          description: 'Аудитория канала'
        },
        channelDaylyActiveUsers: {
          type: 'number',
          description: 'Количество ежедневных активных пользователей канала'
        }
      }
    }
  })
  @ApiResponse({ status: 200, description: 'Статистика продавца бота обновлена' })
  async updateStatistics(
    @Param('id') id: string,
    @Body() statistics: {
      botLiveAudience?: number;
      botMonthlyActiveUsers?: number;
      channelAudience?: number;
      channelDaylyActiveUsers?: number;
    },
    @CurrentUser() user?: AuthUser
  ) {
    if (this.isProd) {
      if (!user) {
        throw new UnauthorizedException('Требуется авторизация.');
      }
      if (!(await this.botSellersService.isUserOwningBot(user.telegramId, +id))) {
        throw new ForbiddenException('У вас нет прав на изменение этого бота.');
      }
    }

    return this.botSellersService.updateStatistics(+id, statistics);
  }


  @Delete(':id')
  @ApiOperation({ summary: 'Удаление продавца бота' })
  @ApiParam({ name: 'id', description: 'ID продавца бота' })
  @ApiResponse({ status: 200, description: 'Продавец бота успешно удален' })
  async remove(@Param('id') id: string,
   @CurrentUser() user?: AuthUser
  ) {
    if (this.isProd) {
      if (!user) {
        throw new UnauthorizedException('Требуется авторизация.');
      }
      if (!(await this.botSellersService.isUserOwningBot(user.telegramId, +id))) {
        throw new ForbiddenException('У вас нет прав на изменение этого бота.');
      }
    }

    return this.botSellersService.remove(+id);
  }

  @Post(':id/upload-statistics')
  @ApiOperation({ summary: 'Загрузка файла статистики для бота' })
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'id', description: 'ID продавца бота' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        statisticsFile: {
          type: 'string',
          format: 'binary',
          description: 'Файл статистики пользователей (.txt)'
        }
      }
    }
  })
  @ApiResponse({ status: 200, description: 'Файл статистики успешно загружен' })
  @UseInterceptors(
    FileInterceptor('statisticsFile', {
      storage: diskStorage({
        destination: './uploads/bot_users',
        filename: (req, file, callback) => {
          const botSellerId = req.params.id;
          const fileName = `botSeller_${botSellerId}_statistics${extname(file.originalname)}`;
          callback(null, fileName);
        },
      }),
      fileFilter: (req, file, callback) => {
        if (file.mimetype !== 'text/plain' && !file.originalname.toLowerCase().endsWith('.txt')) {
          return callback(new Error('Только .txt файлы разрешены'), false);
        }
        if (parseInt(req.headers['content-length']) > 5 * 1024 * 1024) {
          return callback(new Error('Максимальный размер файла - 5MB'), false);
        }
        callback(null, true);
      },
      limits: {
        fileSize: 5 * 1024 * 1024,
      }
    }),
  )
  async uploadStatistics(
    @Param('id') id: string,
    @UploadedFile() statisticsFile: Express.Multer.File,
    @CurrentUser() user?: AuthUser
  ) {
    if (this.isProd) {
      if (!user) {
        throw new UnauthorizedException('Требуется авторизация.');
      }
      if (!(await this.botSellersService.isUserOwningBot(user.telegramId, +id))) {
        throw new ForbiddenException('У вас нет прав на изменение этого бота.');
      }
    }

    return this.botSellersService.uploadStatistics(+id, statisticsFile);
  }

  @Patch(':botId/referral')
  async updateReferralStatus(
    @Param('botId') botId: string,
    @CurrentUser() user?: AuthUser
  ) {
    if (this.isProd) {
      if (!user) {
        throw new UnauthorizedException('Требуется авторизация.');
      }
      if (!(await this.botSellersService.isUserOwningBot(user.telegramId, +botId))) {
        throw new ForbiddenException('У вас нет прав на изменение этого бота.');
      }
    }

    return this.botSellersService.updateReferralStatus(+botId);
  }
} 