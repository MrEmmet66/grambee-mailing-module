import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseInterceptors, UploadedFile, UseGuards } from '@nestjs/common';
import { BotSellersService } from './bot-sellers.service';
import { CreateBotSellerDto, CreateBotSellerFormData, UpdateBotSellerDto } from './dto';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiResponse, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Bot Sellers')
@Controller('bot-sellers')
// @UseGuards(JwtAuthGuard)
export class BotSellersController {
  constructor(private readonly botSellersService: BotSellersService,
              private readonly configService: ConfigService
  ) {}

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
    console.log('Controller received createBotSellerDto:', createBotSellerDto);
    const mainBotToken = this.configService.get<string>('MAIN_BOT', '');
    
    if(createBotSellerDto.isChannel === 'true') {
      createBotSellerDto.botToken = mainBotToken;
    }

    const botSellerData: CreateBotSellerFormData = {
      userId: createBotSellerDto.userId,
      telegramId: createBotSellerDto.telegramId,
      botToken: createBotSellerDto.botToken || mainBotToken,
      usersData: createBotSellerDto.usersData,
      description: createBotSellerDto.description,
      fixedPrice: createBotSellerDto.fixedPrice,
      link: createBotSellerDto.link,
      isChannel: String(createBotSellerDto.isChannel).toLowerCase() === 'true',
      statisticsFile: statisticsFile ? statisticsFile : undefined,
      channelId: createBotSellerDto.channelId,
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
  update(@Param('id') id: string, @Body() updateBotSellerDto: UpdateBotSellerDto) {
    
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
  updateStatus(
    @Param('id') id: string, 
    @Body('status') status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WAITING'
  ) {
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
  updateStatistics(
    @Param('id') id: string,
    @Body() statistics: {
      botLiveAudience?: number;
      botMonthlyActiveUsers?: number;
      channelAudience?: number;
      channelDaylyActiveUsers?: number;
    }
  ) {
    return this.botSellersService.updateStatistics(+id, statistics);
  }

  @Patch(':id/category')
  @ApiOperation({ summary: 'Обновление категории бота' })
  @ApiParam({ name: 'id', description: 'ID продавца бота' })
  @ApiBody({ 
    schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['GAMBLING', 'OTHER', 'DATING', 'GAMES', 'CRYPTO', 'FUN', 'TECH', 'UTILITY'],
          description: 'Новая категория бота'
        }
      }
    }
  })
  @ApiResponse({ status: 200, description: 'Категория бота обновлена' })
  updateCategory(
    @Param('id') id: string, 
    @Body('category') category: 'GAMBLING' | 'OTHER' | 'DATING' | 'GAMES' | 'CRYPTO' | 'FUN' | 'TECH' | 'UTILITY'
  ) {
    return this.botSellersService.updateCategory(+id, category);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удаление продавца бота' })
  @ApiParam({ name: 'id', description: 'ID продавца бота' })
  @ApiResponse({ status: 200, description: 'Продавец бота успешно удален' })
  remove(@Param('id') id: string) {
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
  uploadStatistics(
    @Param('id') id: string,
    @UploadedFile() statisticsFile: Express.Multer.File,
  ) {
    return this.botSellersService.uploadStatistics(+id, statisticsFile);
  }
}