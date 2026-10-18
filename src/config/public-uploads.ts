import { INestApplication } from '@nestjs/common';
import { ServeStaticModuleOptions } from '@nestjs/serve-static';
import { Request, Response, NextFunction } from 'express';
import { posix } from 'node:path';

// Mounted before Nest initializes ServeStaticModule, so private data is never read.
export function protectPrivateUploads(
  app: INestApplication,
  basePath = '/api/v1/uploads',
) {
  app.use(
    basePath,
    (request: Request, response: Response, next: NextFunction) => {
      let pathname: string;
      try {
        pathname = posix.normalize(
          decodeURIComponent(request.path).replaceAll('\\', '/'),
        );
      } catch {
        response.status(400).end();
        return;
      }
      if (/^\/bot_users(?:\/|$)/i.test(pathname)) {
        response.status(404).end();
        return;
      }
      next();
    },
  );
}

export const PUBLIC_UPLOAD_OPTIONS: ServeStaticModuleOptions['serveStaticOptions'] =
  {
    index: false,
    dotfiles: 'deny',
    setHeaders: (response: Response, filePath: string) => {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (!/\.(jpe?g|png|gif|webp|mp4|mp3|ogg|webm)$/i.test(filePath)) {
        response.setHeader('Content-Disposition', 'attachment');
      }
    },
  };
