/*
https://docs.nestjs.com/controllers#controllers
*/

import { Body, Controller, Post, UseInterceptors, UploadedFile, ParseFilePipeBuilder, HttpStatus, Param, Get, Patch, HttpException, Req } from '@nestjs/common';
import { MailingService } from './mailing.service';
import { CreateMailingDto, CreateMailingFormData } from './dto/createMailing.dto';
import { CreateMailingReservationDto } from './dto/createMailingReservation.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { MailingScheduleService } from './mailingSchedue.service';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiBody, ApiParam } from '@nestjs/swagger';

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

        let buttonsJson = dto.buttons || '[]';
        
        try {
            JSON.parse(buttonsJson);
        } catch (error) {
            console.error('Error parsing buttons JSON:', error);
            buttonsJson = '[]';
        }
        
        // Convert userId from string to integer if needed
        const userId = typeof dto.userId === 'string' ? parseInt(dto.userId, 10) : dto.userId;
        
        // Prepare data for the service
        const mailingData: CreateMailingFormData = {
            botToken: dto.botToken,
            userId: userId,
            content: dto.content,
            mediaType: dto.mediaType || 'photo', // Default to photo if not specified
            buttons: buttonsJson,
            media: file
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
}
