import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import * as nodeCrypto from 'crypto';
import { HttpExceptionFilter } from './filters/httpException.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useLogger(['error', 'warn', 'log', 'debug', 'verbose']);

  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableCors({
    origin: (origin, callback) => {
    callback(null, true); // разрешает любой origin
  },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    preflightContinue: false,
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
    })
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
