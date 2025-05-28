import { ApiProperty } from '@nestjs/swagger';

export class CreateMailingDto {
    @ApiProperty({ 
        description: 'Токен бота Telegram',
        example: '1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        required: false
    })
    botToken?: string;

    @ApiProperty({ 
        description: 'ID пользователя, создающего рассылку',
        example: 1 
    })
    userId: number;

    @ApiProperty({ 
        description: 'ID канала, если рассылка для канала (isChannel = true)',
        example: '-1001234567890',
        required: false
    })
    channelId?: string;

    @ApiProperty({
        description: 'Ссылка на бота, если рассылка для бота (isChannel = false)',
        example: 'https://t.me/example_bot',
        required: false
    })
    botLink?: string;

    @ApiProperty({
        description: 'Флаг, указывающий на тип рассылки (канал или бот)',
        example: false,
        required: false
    })
    isChannel?: boolean;

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
        description: 'Текст кнопки для рассылки',
        type: 'string',
        example: 'Перейти'
    })
    buttonContent: string;
}

// This interface represents the form data with file
export interface CreateMailingFormData {
    botToken?: string;
    userId: number;
    channelId?: string;
    botLink?: string;
    isChannel?: boolean;
    content: string;
    mediaType?: string;
    media?: Express.Multer.File;
    buttonContent: string;
}

export interface UpdateMailingContentFormData {
    content: string;
    mediaType?: string;
    media?: Express.Multer.File;
    buttonContent: string;
}

export class UpdateMailingContentDto {
    @ApiProperty({ 
        description: 'Содержимое рассылки (текст)', 
        example: 'Привет! Это обновленная рассылка.'
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
        description: 'Текст кнопки для рассылки',
        type: 'string',
        example: 'Перейти'
    })
    buttonContent: string;
}