import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsNotEmpty, Min } from 'class-validator';

export class CompleteMailingDto {
    @ApiProperty({
        description: 'Имя очереди рассылки',
        example: 'mailing_123'
    })
    @IsString()
    @IsNotEmpty()
    queueName: string;

    @ApiProperty({
        description: 'Количество успешно отправленных сообщений',
        example: 150,
        minimum: 0
    })
    @IsNumber()
    @Min(0)
    sentCount: number;

    @ApiProperty({
        description: 'Количество неудачных отправок',
        example: 5,
        minimum: 0
    })
    @IsNumber()
    @Min(0)
    failedCount: number;
}