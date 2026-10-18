/*
https://docs.nestjs.com/modules
*/

import { Module } from '@nestjs/common';
import { MailingController } from './mailing.controller';
import { MailingService } from './services/mailing.service';
import { MailingScheduleService } from './mailingSchedue.service';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { PrismaModule } from 'prisma/prisma.module';
import { TelegramModule } from '../telegram/telegram.module';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { forwardRef } from '@nestjs/common';
import { MailingPaymentService } from './services/payment.service';
import { BalanceModule } from '../balance/balance.module';
import { ReservationService } from './services/reservation.service';
import { ProcessorService } from './services/processor.service';
import { ProcessorController } from './processor.controller';
import { MailingCheckoutService } from './services/mailingcheckout.service';

@Module({
    imports: [
        forwardRef(() => TelegramModule),
        BalanceModule,
        ConfigModule,
        HttpModule,
        PrismaModule,
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
    controllers: [MailingController, ProcessorController],
    providers: [MailingService, MailingScheduleService, MailingPaymentService, ReservationService, ProcessorService, MailingCheckoutService],
    exports: [MailingService, MailingScheduleService, MailingPaymentService, ReservationService, ProcessorService, MailingCheckoutService],
})
export class MailingModule {}
