/*
https://docs.nestjs.com/modules
*/

import { Module } from '@nestjs/common';
import { CommissionsService } from './commissions.service';
import { CommissionsController } from './commissions.controller';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [CommissionsController],
    providers: [CommissionsService],
})
export class CommissionsModule { }
