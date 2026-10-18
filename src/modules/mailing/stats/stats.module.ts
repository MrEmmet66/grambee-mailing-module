import { Module } from "@nestjs/common";
import { StatsController } from "./stats.controller";
import { StatsService } from "./stats.service";
import { PrismaModule } from "prisma/prisma.module";
import { MailingModule } from "../mailing.module";

@Module({
    imports: [PrismaModule, MailingModule],
    controllers: [StatsController],
    providers: [StatsService],
    exports: [StatsService]
})

export class StatsModule { }