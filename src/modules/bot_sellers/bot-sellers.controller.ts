import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { BotSellersService } from './bot-sellers.service';
import { CreateBotSellerDto, UpdateBotSellerDto } from './dto';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiResponse } from '@nestjs/swagger';

@ApiTags('Bot Sellers')
@Controller('bot-sellers')
export class BotSellersController {
  constructor(private readonly botSellersService: BotSellersService) {}

  @Post()
  @ApiOperation({ summary: 'Создание нового продавца ботов' })
  @ApiBody({ type: CreateBotSellerDto })
  @ApiResponse({ status: 201, description: 'Продавец бота успешно создан' })
  create(@Body() createBotSellerDto: CreateBotSellerDto) {
    return this.botSellersService.create(createBotSellerDto);
  }

  @Get()
  @ApiOperation({ summary: 'Получение всех продавцов ботов' })
  @ApiResponse({ status: 200, description: 'Список всех продавцов ботов' })
  findAll() {
    return this.botSellersService.findAll();
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Получение продавцов ботов по ID пользователя' })
  @ApiParam({ name: 'userId', description: 'ID пользователя' })
  @ApiResponse({ status: 200, description: 'Список продавцов ботов пользователя' })
  findByUserId(@Param('userId') userId: string) {
    return this.botSellersService.findByUserId(+userId);
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

  @Post(':id/regenerate-api-key')
  @ApiOperation({ summary: 'Регенерация API ключа для продавца бота' })
  @ApiParam({ name: 'id', description: 'ID продавца бота' })
  @ApiResponse({ status: 200, description: 'API ключ успешно обновлен' })
  regenerateApiKey(@Param('id') id: string) {
    return this.botSellersService.regenerateApiKey(+id);
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
} 