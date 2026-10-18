import { Server } from 'node:http';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import * as request from 'supertest';
import { mkdtemp, mkdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PUBLIC_UPLOAD_OPTIONS, protectPrivateUploads } from './public-uploads';

describe('Public upload boundary', () => {
  it('serves media but never publishes audience data or executes active content inline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bee-upload-test-'));
    await mkdir(join(root, 'bot_users'));
    await writeFile(join(root, 'bot_users', 'private.txt'), 'private-audience');
    await writeFile(join(root, 'photo.jpg'), 'test-image');
    await writeFile(join(root, 'legacy.html'), '<script>alert(1)</script>');
    @Module({
      imports: [
        ServeStaticModule.forRoot({
          rootPath: root,
          serveRoot: '/uploads',
          serveStaticOptions: PUBLIC_UPLOAD_OPTIONS,
        }),
      ],
    })
    class StaticTestModule {}
    const app = await NestFactory.create(StaticTestModule, { logger: false });
    protectPrivateUploads(app, '/uploads');
    try {
      await app.init();
      const media = await request(app.getHttpServer() as Server)
        .get('/uploads/photo.jpg')
        .expect(200);
      expect(media.headers['x-content-type-options']).toBe('nosniff');
      await request(app.getHttpServer() as Server)
        .get('/uploads/bot_users/private.txt')
        .expect(404);
      const html = await request(app.getHttpServer() as Server)
        .get('/uploads/legacy.html')
        .expect(200);
      expect(html.headers['content-disposition']).toBe('attachment');
    } finally {
      await app.close();
      await unlink(join(root, 'bot_users', 'private.txt'));
      await unlink(join(root, 'photo.jpg'));
      await unlink(join(root, 'legacy.html'));
      await rmdir(join(root, 'bot_users'));
      await rmdir(root);
    }
  });
});
