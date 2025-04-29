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
        
        // Improved parsing logic for buttons
        if (typeof dto.buttons === 'string') {
            try {
                if (dto.buttons && dto.buttons !== 'undefined') {
                    // Fix for JavaScript object notation without quotes around property names
                    // Convert to valid JSON by adding quotes to property names
                    const buttonsStr = dto.buttons as string; // Explicit cast to string
                    const fixedJsonString = buttonsStr
                        .replace(/(\w+):/g, '"$1":')  // Add quotes around property names
                        .replace(/'/g, '"');          // Replace single quotes with double quotes if needed
                    
                    buttons = JSON.parse(fixedJsonString);
                } else {
                    buttons = []; // Default to empty array if undefined
                }
            } catch (error) {
                console.error('Error parsing buttons JSON:', dto.buttons);
                
                // Attempt to parse using Function constructor as a fallback for JavaScript object notation
                try {
                    const buttonsStr = dto.buttons as string;
                    buttons = new Function('return ' + buttonsStr)();
                } catch (funcError) {
                    console.error('Fallback parsing also failed:', funcError);
                    buttons = []; // Default to empty array on parsing error
                }
            }
        } else if (!dto.buttons) {
            buttons = []; // Ensure buttons is at least an empty array if null or undefined
        }
        
        // Convert userId from string to integer
        const userId = typeof dto.userId === 'string' ? parseInt(dto.userId, 10) : dto.userId;
        
        return await this.mailingService.createMailing({
            ...dto,
            userId,
            buttons,
            media: file,
        } as CreateMailingFormData);
    }
}
