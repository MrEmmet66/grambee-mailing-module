import { ServiceOnly } from '../auth/decorators/auth-policy.decorator';
import { Body, Controller, Param, Post } from '@nestjs/common';
import { ReservationService } from './services/reservation.service';
import { CompleteMailingDto } from './dto/completeMailing.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';

@ApiTags('processor')
@ServiceOnly()
@Controller('processor')
export class ProcessorController {
  constructor(private readonly reservationService: ReservationService) {}

  @Post('finish')
  @ApiOperation({ summary: 'Завершить рассылку и обновить статистику' })
  @ApiBody({
    type: CompleteMailingDto,
    description: 'Данные о завершенной рассылке',
  })
  @ApiResponse({
    status: 200,
    description: 'Рассылка успешно завершена',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Queue completed successfully' },
        queueName: { type: 'string', example: 'mailing_123' },
        sentCount: { type: 'number', example: 150 },
        failedCount: { type: 'number', example: 5 },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Очередь не найдена' })
  async finishReservation(@Body() dto: CompleteMailingDto) {
    await this.reservationService.completeQueue(dto);

    return {
      success: true,
      message: 'Queue completed successfully',
      queueName: dto.queueName,
      sentCount: dto.sentCount,
      failedCount: dto.failedCount,
    };
  }
}
