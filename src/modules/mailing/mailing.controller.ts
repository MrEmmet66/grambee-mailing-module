/*
https://docs.nestjs.com/controllers#controllers
*/

import { Body, Controller, Post, UseInterceptors, UploadedFile, ParseFilePipeBuilder, HttpStatus } from '@nestjs/common';
import { MailingService } from './mailing.service';
import { CreateMailingDto, CreateMailingFormData } from './dto/createMailing.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';

@Controller('mailings')
export class MailingController {
    constructor(private readonly mailingService: MailingService) {}

    @Post()
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
        @Body() dto: CreateMailingDto,
        @UploadedFile(
            new ParseFilePipeBuilder()
                .addFileTypeValidator({
                    fileType: /(jpg|jpeg|png|gif|mp4|avi|mov)$/,
                })
                .addMaxSizeValidator({
                    maxSize: 10 * 1024 * 1024, // 10MB
                })
                .build({
                    errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
                    fileIsRequired: true,
                }),
        ) file: Express.Multer.File,
    ) {
        let buttons = dto.buttons;
        if (typeof dto.buttons === 'string') {
            buttons = JSON.parse(dto.buttons as any);
        }
        
        return await this.mailingService.createMailing({
            ...dto,
            buttons,
            media: file,
        } as CreateMailingFormData);
    }
}
