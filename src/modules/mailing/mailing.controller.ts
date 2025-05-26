/*
https://docs.nestjs.com/controllers#controllers
*/

import { Body, Controller, Post, UseInterceptors, UploadedFile, ParseFilePipeBuilder, HttpStatus, Param, Get, Patch, HttpException, Req, Query } from '@nestjs/common';
import { MailingService } from './services/mailing.service';
import { CreateMailingDto, CreateMailingFormData } from './dto/createMailing.dto';
import { CreateMailingReservationDto } from './dto/createMailingReservation.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { MailingScheduleService } from './mailingSchedue.service';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiBody, ApiParam } from '@nestjs/swagger';
import { log } from 'console';

@ApiTags('mailings')
@Controller('mailings')
export class MailingController {
    constructor(
        private readonly mailingService: MailingService,
        private readonly mailingScheduleService: MailingScheduleService
    ) {}

    @Post()
    @ApiOperation({ summary: 'Создать новую рассылку' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        description: 'Данные для создания рассылки с возможностью загрузки медиа-файла',
        type: CreateMailingDto
    })
    @ApiResponse({ status: 201, description: 'Рассылка успешно создана.' })
    @ApiResponse({ status: 400, description: 'Неверные данные для создания рассылки.' })
    @UseInterceptors(FileInterceptor('media', {
        storage: diskStorage({
            destination: './uploads',
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
                const ext = extname(file.originalname);
                cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
            },
        }),
    }))
    async createMailing(
        @Body() dto: CreateMailingFormData,
        @UploadedFile(
            new ParseFilePipeBuilder()
                .addMaxSizeValidator({
                    maxSize: 10 * 1024 * 1024, // 10MB
                })
                .build({
                    errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
                    fileIsRequired: false, // Changed to false to make file optional
                }),
        ) file: Express.Multer.File,
        @Req() req: Request
    ) {

        // Validate required fields
        if (!dto.botToken) {
            throw new HttpException('Bot token is required', HttpStatus.BAD_REQUEST);
        }
        
        if (!dto.userId) {
            throw new HttpException('User ID is required', HttpStatus.BAD_REQUEST);
        }
        
        if (!dto.content) {
            throw new HttpException('Content is required', HttpStatus.BAD_REQUEST);
        }

        // Convert userId from string to integer if needed
        const userId = typeof dto.userId === 'string' ? parseInt(dto.userId, 10) : dto.userId;
        
        // Prepare data for the service
        const mailingData: CreateMailingFormData = {
            botToken: dto.botToken,
            userId: userId,
            content: dto.content,
            mediaType: dto.mediaType || 'photo', // Default to photo if not specified
            buttonContent: dto.buttonContent,
            media: file,
            channelId: dto.channelId, // Optional field
            botLink: dto.botLink, // Optional field
            isChannel: dto.isChannel || false // Optional field
        };
        
        // Call the service to create the mailing
        return await this.mailingService.createMailing(mailingData);
    }

    @Post('reserve')
    async reserveMailingDay(@Body() dto: CreateMailingReservationDto) {
        console.log(dto);
        
        return await this.mailingService.reserveMailingDay(dto);
    }

    @Patch(':id/toggle')
    @ApiOperation({ summary: 'Включить/выключить рассылку' })
    @ApiParam({ name: 'id', description: 'ID рассылки' })
    @ApiResponse({ status: 200, description: 'Статус рассылки изменен.' })
    @ApiResponse({ status: 404, description: 'Рассылка не найдена.' })
    async toggleMailingStatus(@Param('id') id: string) {
        return await this.mailingService.toggleMailingStatus(parseInt(id, 10));
    }

    @Get('run-test/:id')
    @ApiOperation({ summary: 'Запустить тест рассылки по ID' })
    @ApiParam({ name: 'id', description: 'ID рассылки' })
    @ApiResponse({ 
        status: 200, 
        description: 'Тестовая рассылка запущена.',
        schema: {
            type: 'object',
            properties: {
                mailingId: { type: 'number', example: 1 },
                processedReservations: { type: 'number', example: 2 },
                results: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            reservationId: { type: 'number', example: 1 },
                            botSellerId: { type: 'number', example: 3 },
                            status: { type: 'string', example: 'success' }
                        }
                    }
                }
            }
        }
    })
    @ApiResponse({ status: 404, description: 'Рассылка не найдена или неактивна.' })
    async runTestMailing(@Param('id') id: string) {
        console.log(`Running test mailing for ID: ${id}`);
        
        return await this.mailingScheduleService.runMailingById(parseInt(id, 10));
    }

    @Patch(':id/status')
    @ApiOperation({ summary: 'Обновить статус рассылки (approve/reject/wait)' })
    @ApiParam({ name: 'id', description: 'ID рассылки' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                status: { 
                    type: 'string', 
                    enum: ['PENDING', 'APPROVED', 'REJECTED', 'WAITING'],
                    example: 'APPROVED'
                }
            }
        }
    })
    @ApiResponse({ status: 200, description: 'Статус рассылки обновлен.' })
    @ApiResponse({ status: 404, description: 'Рассылка не найдена.' })
    async updateMailingStatus(
        @Param('id') id: string,
        @Body() body: { status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WAITING' }
    ) {
        return await this.mailingService.updateMailingStatus(parseInt(id, 10), body.status);
    }

    @Get('/user/:userId')
    @ApiOperation({ summary: 'Получить все рассылки пользователя' })
    @ApiParam({ name: 'userId', description: 'ID пользователя' })
    @ApiResponse({ 
        status: 200, 
        description: 'Список рассылок пользователя.',
        schema: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'number', example: 1 },
                    botToken: { type: 'string', example: '1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
                    userId: { type: 'number', example: 1 },
                    content: { type: 'string', example: 'Привет! Это тестовая рассылка.' },
                    mediaType: { type: 'string', example: 'photo' },
                    buttons: { type: 'string', example: '[{"text":"Перейти","url":"https://example.com"}]' },
                    createdAt: { type: 'string', format: 'date-time', example: '2023-10-01T12:00:00Z' },
                    updatedAt: { type: 'string', format: 'date-time', example: '2023-10-01T12:00:00Z' }
                }
            }
        }
    })
    @ApiResponse({ status: 404, description: 'Пользователь не найден.' })
    async getUserMailings(@Param('userId') userId: string) {
        return await this.mailingService.getUserMailings(parseInt(userId, 10));
    }

    @Get('/date')
    @ApiOperation({ summary: 'Получить все рассылки на определенную дату' })
    @ApiResponse({ 
        status: 200, 
        description: 'Список рассылок на определенную дату.',
        schema: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'number', example: 1 },
                    userId: { type: 'number', example: 1 },
                    content: { type: 'string', example: 'Привет! Это тестовая рассылка.' },
                    mediaType: { type: 'string', example: 'photo' },
                    buttons: { type: 'string', example: '[{"text":"Перейти","url":"https://example.com"}]' },
                    createdAt: { type: 'string', format: 'date-time', example: '2023-10-01T12:00:00Z' },
                    updatedAt: { type: 'string', format: 'date-time', example: '2023-10-01T12:00:00Z' }
                }
            }
        }
    })
    @ApiResponse({ status: 404, description: 'Рассылка не найдена.' })
    async getMailingsByDate(@Query('date') date: string, @Query('sellerId') sellerId: string) {
        // Validate sellerId
        if (!sellerId) {
            throw new HttpException('Seller ID is required', HttpStatus.BAD_REQUEST);
        }
        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date)) {
            throw new HttpException('Invalid date format. Use YYYY-MM-DD.', HttpStatus.BAD_REQUEST);
        }
        // Parse date to Date object
        const parsedDate = new Date(date);
        if (isNaN(parsedDate.getTime())) {
            throw new HttpException('Invalid date.', HttpStatus.BAD_REQUEST);
        }

        return await this.mailingService.getMailingsByDate(parsedDate, sellerId);
    }

    
}
