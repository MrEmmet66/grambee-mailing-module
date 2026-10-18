import { Test } from '@nestjs/testing';
import { getBotToken } from 'nestjs-telegraf';
import { PrismaService } from '../prisma/prisma.service';

describe('Application dependency graph', () => {
  it('resolves the complete application without contacting Telegram or the database', async () => {
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters';
    process.env.SECRET_KEY =
      'different-test-service-secret-at-least-32-characters';
    process.env.BOT_TOKEN = '123456789:test-bot-token';
    const { AppModule } = await import('./app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
      .overrideProvider(getBotToken())
      .useValue({
        botInfo: { id: 123456789 },
        stop: jest.fn(),
        telegram: {
          deleteWebhook: jest.fn(),
          getMe: jest.fn().mockResolvedValue({ id: 123456789 }),
        },
      })
      .compile();
    await module.close();
  });
});
