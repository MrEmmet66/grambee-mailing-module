import { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AuthModule } from './auth.module';
import { UsersModule } from '../users/users.module';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthRepository } from './repositories/auth.repository';
import { MailingController } from '../mailing/mailing.controller';
import { MailingService } from '../mailing/services/mailing.service';
import { ReservationService } from '../mailing/services/reservation.service';
import { MailingScheduleService } from '../mailing/mailingSchedue.service';
import { ProcessorController } from '../mailing/processor.controller';
import { BotSellersController } from '../bot_sellers/bot-sellers.controller';
import { BotSellersService } from '../bot_sellers/bot-sellers.service';

describe('HTTP authentication and ownership boundaries', () => {
  let app: INestApplication;
  let access: string;
  let refresh: string;
  const secret = 'test-jwt-secret-at-least-32-characters';
  const serviceKey = 'different-service-key-at-least-32-characters';
  const user = {
    id: 7,
    telegramId: '987654321',
    username: 'demo',
    createdAt: new Date(),
    passwordHash: 'private-password',
    refreshTokenHash: 'private-refresh',
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    mailing: { findFirst: jest.fn() },
    botSeller: { findFirst: jest.fn() },
  };
  const mailings = {
    getUserMailings: jest.fn().mockResolvedValue([
      {
        id: 1,
        user,
        botToken: 'private-bot',
        usersData: ['private-audience'],
      },
    ]),
    updateMailingContent: jest.fn(),
    createMailing: jest.fn().mockResolvedValue({ id: 1 }),
  };
  const reservations = { completeQueue: jest.fn() };
  const bots = { updateStatus: jest.fn().mockResolvedValue({ id: 1 }) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: secret, SECRET_KEY: serviceKey })],
        }),
        AuthModule,
        UsersModule,
      ],
      controllers: [
        MailingController,
        ProcessorController,
        BotSellersController,
      ],
      providers: [
        { provide: MailingService, useValue: mailings },
        { provide: ReservationService, useValue: reservations },
        { provide: MailingScheduleService, useValue: {} },
        { provide: BotSellersService, useValue: bots },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(AuthRepository)
      .useValue({ findById: jest.fn().mockResolvedValue(user) })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    const jwt = new JwtService({ secret });
    access = jwt.sign({
      sub: 7,
      telegramId: user.telegramId,
      type: 'access',
      jti: 'test-access',
    });
    refresh = jwt.sign({
      sub: 7,
      telegramId: user.telegramId,
      type: 'refresh',
      jti: 'test-refresh',
    });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('rejects anonymous requests by default', async () => {
    await request(app.getHttpServer() as Server)
      .get('/users/7')
      .expect(401);
    await request(app.getHttpServer() as Server)
      .get('/mailings/user/987654321')
      .expect(401);
  });
  it('rejects refresh tokens used as bearer access tokens', async () => {
    await request(app.getHttpServer() as Server)
      .get('/users/7')
      .auth(refresh, { type: 'bearer' })
      .expect(401);
  });
  it('prevents reading another account and strips nested secrets from legitimate responses', async () => {
    await request(app.getHttpServer() as Server)
      .get('/users/8')
      .auth(access, { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer() as Server)
      .get('/mailings/user/111')
      .auth(access, { type: 'bearer' })
      .expect(404);
    const response = await request(app.getHttpServer() as Server)
      .get('/mailings/user/987654321')
      .auth(access, { type: 'bearer' })
      .expect(200);
    expect(JSON.stringify(response.body)).not.toContain('private-');
  });
  it('checks ownership before accepting a multipart upload in development too', async () => {
    prisma.mailing.findFirst.mockResolvedValueOnce(null);
    await request(app.getHttpServer() as Server)
      .patch('/mailings/post/99')
      .auth(access, { type: 'bearer' })
      .field('content', 'unauthorized')
      .expect(404);
    expect(mailings.updateMailingContent).not.toHaveBeenCalled();
  });
  it('ignores a forged owner ID when creating a mailing', async () => {
    await request(app.getHttpServer() as Server)
      .post('/mailings')
      .auth(access, { type: 'bearer' })
      .field('userId', '999')
      .field('content', 'test post')
      .expect(201);
    expect(mailings.createMailing).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7 }),
    );
  });
  it('requires service credentials for provisioning, moderation and completion callbacks', async () => {
    await request(app.getHttpServer() as Server)
      .post('/users')
      .send({})
      .expect(401);
    await request(app.getHttpServer() as Server)
      .post('/processor/finish')
      .send({})
      .expect(401);
    await request(app.getHttpServer() as Server)
      .patch('/bot-sellers/1/status')
      .auth(access, { type: 'bearer' })
      .send({ status: 'APPROVED' })
      .expect(401);
    await request(app.getHttpServer() as Server)
      .post('/processor/finish')
      .set('x-request-secret', serviceKey)
      .send({ queueName: 'mailing_1', sentCount: 1, failedCount: 0 })
      .expect(201);
    expect(reservations.completeQueue).toHaveBeenCalledTimes(1);
  });
  it('validates actual auth DTOs and keeps the test-send endpoint unavailable', async () => {
    await request(app.getHttpServer() as Server)
      .post('/auth/login')
      .send({ telegramId: {}, password: [] })
      .expect(400);
    await request(app.getHttpServer() as Server)
      .post('/auth/refresh')
      .send({ userId: -1, refreshToken: '' })
      .expect(400);
    await request(app.getHttpServer() as Server)
      .get('/mailings/run-test/1')
      .auth(access, { type: 'bearer' })
      .expect(404);
  });
  it('rejects active media uploads and throttles repeated login attempts', async () => {
    await request(app.getHttpServer() as Server)
      .post('/mailings')
      .auth(access, { type: 'bearer' })
      .field('content', 'test')
      .attach('media', Buffer.from('<script>alert(1)</script>'), {
        filename: 'payload.html',
        contentType: 'text/html',
      })
      .expect(400);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt++) {
      const response = await request(app.getHttpServer() as Server)
        .post('/auth/login')
        .send({});
      statuses.push(response.status);
    }
    expect(statuses).toContain(429);
  });
});
