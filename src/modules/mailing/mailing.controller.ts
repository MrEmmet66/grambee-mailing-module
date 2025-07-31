/*
https://docs.nestjs.com/controllers#controllers
*/

import { Body, Controller, Post, UseInterceptors, UploadedFile, ParseFilePipeBuilder, HttpStatus, Param, Get, Patch, HttpException, Req, Query, Put, Delete, UseGuards } from '@nestjs/common';
import { MailingService } from './services/mailing.service';
import { ReservationService } from './services/reservation.service';
import { CreateMailingDto, CreateMailingFormData, UpdateMailingContentFormData, UpdateMailingContentDto } from './dto/createMailing.dto';
import { CreateMailingReservationDto } from './dto/createMailingReservation.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { MailingScheduleService } from './mailingSchedue.service';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiBody, ApiParam } from '@nestjs/swagger';
import { MailingStatus } from '@prisma/client';
import { log } from 'console';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('mailings')
@Controller('mailings')
// @UseGuards(JwtAuthGuard)
export class MailingController {
        constructor(
            private readonly mailingService: MailingService,
            private readonly mailingScheduleService: MailingScheduleService,
            private readonly reservationService: ReservationService
        ) { }

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

        console.log('got file:', file);


        if (!dto.userId) {
            throw new HttpException('User ID is required', HttpStatus.BAD_REQUEST);
        }

        if (!dto.content) {
            throw new HttpException('Content is required', HttpStatus.BAD_REQUEST);
        }

        // Convert userId from string to integer if needed
        const userId = typeof dto.userId === 'string' ? parseInt(dto.userId, 10) : dto.userId;
        const isChannel = dto.isChannel === 'true'

        // Prepare data for the service
        let buttons: string[] = [];
        // Debug log raw buttons input
        console.log('RAW BUTTONS:', dto.buttons);
        if (dto.buttons) {
            if (typeof dto.buttons === 'string') {
                try {
                    const parsed = JSON.parse(dto.buttons);
                    console.log('PARSED BUTTONS:', parsed);
                    if (Array.isArray(parsed)) {
                        buttons = parsed;
                    } else {
                        buttons = [];
                    }
                } catch (e) {
                    console.log('BUTTONS PARSE ERROR:', e);
                    buttons = [];
                }
            } else if (Array.isArray(dto.buttons)) {
                if (
                    dto.buttons.length === 1 &&
                    typeof (dto.buttons[0] as string) === 'string' &&
                    ((dto.buttons[0] as string).startsWith('['))
                ) {
                    try {
                        const parsed = JSON.parse(dto.buttons[0] as string);
                        console.log('PARSED BUTTONS:', parsed);
                        if (Array.isArray(parsed)) {
                            buttons = parsed;
                        } else {
                            buttons = [];
                        }
                    } catch (e) {
                        console.log('BUTTONS PARSE ERROR:', e);
                        buttons = [];
                    }
                } else {
                    buttons = dto.buttons;
                }
            }
        }
        const mailingData: CreateMailingDto = {
            botToken: dto.botToken,
            userId: userId,
            content: dto.content,
            mediaType: dto.mediaType || 'photo', // Default to photo if not specified
            buttons,
            media: file,
            link: dto.link, // Optional field
            isChannel: isChannel
        };

        // Call the service to create the mailing
        return await this.mailingService.createMailing(mailingData);
    }

    @Post('reserve')
    async reserveMailingDay(@Body() dto: CreateMailingReservationDto) {

        return await this.reservationService.reserveMailingDay(dto);
    }

    @Patch('/post/:id')
    @ApiOperation({ summary: 'Обновить контент рассылки' })
    @ApiConsumes('multipart/form-data')
    @ApiParam({ name: 'id', description: 'ID рассылки' })
    @ApiBody({
        description: 'Данные для обновления контента рассылки с возможностью загрузки медиа-файла',
        type: UpdateMailingContentDto
    })
    @ApiResponse({ status: 200, description: 'Контент рассылки успешно обновлен.' })
    @ApiResponse({ status: 404, description: 'Рассылка не найдена.' })
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
    async updateMailingContent(
        @Param('id') id: string,
        @Body() updateData: UpdateMailingContentFormData,
        @UploadedFile(
            new ParseFilePipeBuilder()
                .addMaxSizeValidator({
                    maxSize: 10 * 1024 * 1024, // 10MB
                })
                .build({
                    errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
                    fileIsRequired: false, // File is optional for updates
                }),
        ) file: Express.Multer.File
    ) {
        const mailingId = parseInt(id, 10);

        if (!updateData.content) {
            throw new HttpException('Content is required', HttpStatus.BAD_REQUEST);
        }

        // Add the uploaded file to the update data
        let buttons: string[] = [];
        console.log('RAW BUTTONS (update):', updateData.buttons);
        if (updateData.buttons) {
            if (typeof updateData.buttons === 'string') {
                try {
                    const parsed = JSON.parse(updateData.buttons);
                    console.log('PARSED BUTTONS (update):', parsed);
                    if (Array.isArray(parsed)) {
                        buttons = parsed;
                    } else {
                        buttons = [];
                    }
                } catch (e) {
                    console.log('BUTTONS PARSE ERROR (update):', e);
                    buttons = [];
                }
            } else if (Array.isArray(updateData.buttons)) {
                buttons = updateData.buttons;
            }
        }
        const updateDataWithFile: UpdateMailingContentFormData = {
            ...updateData,
            media: file,
            buttons
        };

        console.log('data:', updateDataWithFile);

        return await this.mailingService.updateMailingContent(mailingId, updateDataWithFile);
    }

    @Patch(':id/toggle')
    @ApiOperation({ summary: 'Включить/выключить рассылку' })
    @ApiParam({ name: 'id', description: 'ID рассылки' })
    @ApiResponse({ status: 200, description: 'Статус рассылки изменен.' })
    @ApiResponse({ status: 404, description: 'Рассылка не найдена.' })
    async toggleMailingStatus(@Param('id') id: string) {
        return await this.mailingService.toggleMailingStatus(parseInt(id, 10));
    } @Delete('reservations/:id')
    @ApiOperation({
        summary: 'Отменить резервирование рассылки по ID',
        description: 'Отменяет резервирование не менее чем за 48 часов до даты. Возвращает покупателю 70%, продавцу 25%, комиссия 5%.'
    })
    @ApiParam({ name: 'id', description: 'ID резервирования рассылки' })
    @ApiResponse({
        status: 200,
        description: 'Резервирование отменено с частичным возвратом средств.',
        schema: {
            type: 'object',
            properties: {
                reservation: { type: 'object', description: 'Удаленное резервирование' },
                refundDetails: {
                    type: 'object',
                    properties: {
                        totalHeldAmount: { type: 'number', description: 'Общая удержанная сумма' },
                        buyerRefundAmount: { type: 'number', description: 'Сумма возврата покупателю (70%)' },
                        sellerCompensationAmount: { type: 'number', description: 'Компенсация продавцу (25%)' },
                        cancellationFee: { type: 'number', description: 'Комиссия за отмену (5%)' },
                        buyerTelegramId: { type: 'string', description: 'Telegram ID покупателя' },
                        sellerTelegramId: { type: 'string', description: 'Telegram ID продавца' }
                    }
                }
            }
        }
    })
    @ApiResponse({ status: 404, description: 'Резервирование не найдено.' })
    @ApiResponse({ status: 409, description: 'Резервирование нельзя отменить (менее 48 часов до даты или уже обработано).' })
    @ApiResponse({ status: 412, description: 'Ошибка обработки возврата средств.' })
    @ApiResponse({ status: 200, description: 'Резервирование рассылки успешно удалено.' })
    @ApiResponse({ status: 404, description: 'Резервирование рассылки не найдено.' })
    async deleteMailingReservation(@Param('id') id: string) {
        const reservationId = parseInt(id, 10);
        if (isNaN(reservationId)) {
            throw new HttpException('Invalid reservation ID', HttpStatus.BAD_REQUEST);
        }

        return await this.reservationService.removeMailingReservation(reservationId);
    }

    @Get('run-test/:id')
    @UseGuards()
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

    @Delete(':id')
    @ApiOperation({ summary: 'Удалить рассылку по ID' })
    @ApiParam({ name: 'id', description: 'ID рассылки' })
    @ApiResponse({ status: 200, description: 'Рассылка успешно удалена.' })
    @ApiResponse({ status: 404, description: 'Рассылка не найдена.' })
    async deleteMailing(@Param('id') id: string) {
        const mailingId = parseInt(id, 10);
        if (isNaN(mailingId)) {
            throw new HttpException('Invalid mailing ID', HttpStatus.BAD_REQUEST);
        }

        return await this.mailingService.deleteMailing(mailingId);
    }

    @Get('reservations/:sellerId')
    @ApiOperation({ summary: 'Получить календарь доступности для резервирования рассылок' })
    @ApiParam({ name: 'sellerId', description: 'ID продавца бота' })
    @ApiResponse({
        status: 200,
        description: 'Календарь доступности на 30 дней.',
    })
    async getMailingCalendar(@Param('sellerId') sellerId: string) {
        const sellerIdNum = parseInt(sellerId, 10);
        if (isNaN(sellerIdNum)) {
            throw new HttpException('Invalid seller ID', HttpStatus.BAD_REQUEST);
        }

        return await this.reservationService.getMailingReservationsBySellerId(sellerIdNum);
    }

    @Get('reservations/mailing/:id')
    async getMailingReservations(@Param('id') id: string) {
        const mailingId = parseInt(id, 10);
        if (isNaN(mailingId)) {
            throw new HttpException('Invalid mailing ID', HttpStatus.BAD_REQUEST);
        }

        return await this.reservationService.getMailingReservations(mailingId);
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
                    userId: { type: 'number', example: 1 },
                    botToken: { type: 'string', example: '1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZ', nullable: true },
                    channelId: { type: 'string', example: '-1001234567890', nullable: true },
                    isChannel: { type: 'boolean', example: false },
                    botLink: { type: 'string', example: 'https://t.me/example_bot', nullable: true },
                    status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'WAITING', 'COMPLETED'], example: 'PENDING' },
                    isActive: { type: 'boolean', example: false },
                    postContent: { type: 'string', example: 'Привет! Это тестовая рассылка.' },
                    postButtons: { type: 'object', example: '[{"text":"Перейти","url":"https://example.com"}]' },
                    postMedia: { type: 'string', example: 'uploads/media-123456789.jpg', nullable: true },
                    postMediaType: { type: 'string', example: 'photo', nullable: true }
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
                    botToken: { type: 'string', example: '1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZ', nullable: true },
                    channelId: { type: 'string', example: '-1001234567890', nullable: true },
                    isChannel: { type: 'boolean', example: false },
                    botLink: { type: 'string', example: 'https://t.me/example_bot', nullable: true },
                    status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'WAITING', 'COMPLETED'], example: 'PENDING' },
                    isActive: { type: 'boolean', example: false },
                    postContent: { type: 'string', example: 'Привет! Это тестовая рассылка.' },
                    postButtons: { type: 'object', example: '[{"text":"Перейти","url":"https://example.com"}]' },
                    postMedia: { type: 'string', example: 'uploads/media-123456789.jpg', nullable: true },
                    postMediaType: { type: 'string', example: 'photo', nullable: true }
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

        return await this.reservationService.getMailingsByDate(parsedDate, sellerId);
    }

    @Get('reservations/:id/can-cancel')
    @ApiOperation({
        summary: 'Проверить возможность отмены резервирования',
        description: 'Проверяет, можно ли отменить резервирование и показывает предварительный расчет возврата средств.'
    })
    @ApiParam({ name: 'id', description: 'ID резервирования рассылки' })
    @ApiResponse({
        status: 200,
        description: 'Информация о возможности отмены резервирования.',
        schema: {
            type: 'object',
            properties: {
                canCancel: { type: 'boolean', description: 'Можно ли отменить резервирование' },
                reason: { type: 'string', description: 'Причина, если нельзя отменить' },
                hoursUntilReservation: { type: 'number', description: 'Часов до даты резервирования' },
                refundPreview: {
                    type: 'object',
                    properties: {
                        totalHeldAmount: { type: 'number', description: 'Общая удержанная сумма' },
                        buyerRefundAmount: { type: 'number', description: 'Возврат покупателю (70%)' },
                        sellerCompensationAmount: { type: 'number', description: 'Компенсация продавцу (25%)' },
                        cancellationFee: { type: 'number', description: 'Комиссия за отмену (5%)' }
                    }
                }
            }
        }
    })
    async canCancelReservation(@Param('id') id: string) {
        const reservationId = parseInt(id, 10);

        if (isNaN(reservationId)) {
            throw new HttpException('Invalid reservation ID', HttpStatus.BAD_REQUEST);
        }

        return await this.reservationService.canCancelReservation(reservationId);
    }
}
