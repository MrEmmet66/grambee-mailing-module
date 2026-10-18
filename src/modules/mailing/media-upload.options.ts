import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { diskStorage } from 'multer';

const ALLOWED_TYPES: Record<string, string[]> = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.mp4': ['video/mp4'],
  '.mp3': ['audio/mpeg'],
  '.ogg': ['audio/ogg'],
  '.webm': ['video/webm'],
  '.pdf': ['application/pdf'],
};

export const MEDIA_UPLOAD_OPTIONS: MulterOptions = {
  storage: diskStorage({
    destination: './uploads',
    filename: (_request, file, done) =>
      done(null, randomUUID() + extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 20 },
  fileFilter: (_request, file, done) => {
    const types = ALLOWED_TYPES[extname(file.originalname).toLowerCase()];
    if (!types?.includes(file.mimetype))
      return done(new BadRequestException('Unsupported media type'), false);
    done(null, true);
  },
};
