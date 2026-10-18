import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder,SwaggerModule } from '@nestjs/swagger';
import * as nodeCrypto from 'crypto';
import { AppModule } from './app.module';
import { protectPrivateUploads } from './config/public-uploads';
import { HttpExceptionFilter } from './filters/httpException.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  protectPrivateUploads(app);

  app.useLogger(['error', 'warn', 'log', 'debug', 'verbose']);

  app.useGlobalFilters(new HttpExceptionFilter());

  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  });

  // Add validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.setGlobalPrefix('api/v1');

  // Настройка Swagger
  const config = new DocumentBuilder()
    .setTitle('Bee App Mailing API')
    .setDescription('API для работы с рассылками и ботами')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}

if (!globalThis.crypto) {
  globalThis.crypto = nodeCrypto.webcrypto as any;
}

bootstrap();
