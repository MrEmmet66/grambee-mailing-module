import { ApiProperty } from '@nestjs/swagger';

export class CreateMailingDto {
    @ApiProperty({ 
        description: 'Токен бота Telegram',
        example: '1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZ' 
    })
    botToken: string;

    @ApiProperty({ 
        description: 'ID пользователя, создающего рассылку',
        example: 1 
    })
    userId: number;

    @ApiProperty({ 
        description: 'Содержимое рассылки (текст)', 
        example: 'Привет! Это тестовая рассылка.'
    })
    content: string;

    @ApiProperty({ 
        description: 'Тип медиа (photo, video, document, audio)', 
        enum: ['photo', 'video', 'document', 'audio'],
        required: false,
        example: 'photo'
    })
    mediaType?: string;

    @ApiProperty({ 
        description: 'Медиа файл для рассылки', 
        type: 'string', 
        format: 'binary',
        required: false 
    })
    media?: Express.Multer.File;

    @ApiProperty({ 
        description: 'Кнопки для рассылки в формате JSON-строки',
        type: 'string',
        example: '[{"text":"Перейти","url":"https://example.com"}]'
    })
    buttons: string;
}

// This interface represents the form data with file
export interface CreateMailingFormData {
    botToken: string;
    userId: number;
    content: string;
    mediaType?: string;
    media?: Express.Multer.File;
    buttons: string;
}