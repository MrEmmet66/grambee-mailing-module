import { ServiceOnly } from '../auth/decorators/auth-policy.decorator';
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CommissionsService } from './commissions.service';

@ServiceOnly()
@Controller('commissions')
export class CommissionsController {
  constructor(private readonly commissionsService: CommissionsService) {}

  @Get('user/:userId')
  async getUserCommissions(
    @Param('userId') userId: number,
    @Query('dateFrom') dateFrom?: Date,
    @Query('dateTo') dateTo?: Date,
  ) {
    return this.commissionsService.getUserCommissions(userId, dateFrom, dateTo);
  }

  @Get('mailing/:mailingId')
  async getMailingCommissions(
    @Param('mailingId') mailingId: number,
    @Query('dateFrom') dateFrom?: Date,
    @Query('dateTo') dateTo?: Date,
  ) {
    return this.commissionsService.getMailingCommissions(
      mailingId,
      dateFrom,
      dateTo,
    );
  }

  @Get()
  async getAllCommissions(
    @Query('dateFrom') dateFrom?: Date,
    @Query('dateTo') dateTo?: Date,
  ) {
    return this.commissionsService.getTotalCommissions(dateFrom, dateTo);
  }
}
