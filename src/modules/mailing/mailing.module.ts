/*
https://docs.nestjs.com/modules
*/

import { Module } from '@nestjs/common';
import { MailingController } from './mailing.controller';
import { MailingService } from './mailing.service';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { PrismaModule } from 'prisma/prisma.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
    imports: [
        PrismaModule,
        TelegramModule,
        MulterModule.register({
            storage: diskStorage({
                destination: './uploads',
                filename: (req, file, cb) => {
                    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
                    const ext = extname(file.originalname);
                    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
                },
            }),
        }),
    ],
    controllers: [MailingController],
    providers: [MailingService],
})
export class MailingModule {}
