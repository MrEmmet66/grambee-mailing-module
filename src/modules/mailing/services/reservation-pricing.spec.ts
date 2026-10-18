import { PreconditionFailedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReservationService } from './reservation.service';

const PRICING = {
  SERVICE_COMMISSION_FIXED: 10,
  SERVICE_COMMISSION_PER_USER: 0.00005,
  SERVICE_DEFAULT_SUBSCRIBER_PRICE: 0.0005,
  SERVICE_CHANNEL_DEFAULT_SUBSCRIBER_PRICE: 0.0002,
};

function configWith(values: Record<string, unknown> = PRICING): ConfigService {
  return {
    get: (key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
  } as unknown as ConfigService;
}

type Seller = {
  id: number;
  link: string;
  isChannel: boolean;
  fixedPrice?: number | null;
  totalBotAudience?: number | null;
  channelAudience?: number | null;
};

function setup(seller: Seller) {
  const holds: Array<{ amount: number; description: string }> = [];
  const targetBots: Array<Record<string, unknown>> = [];
  const prisma = {
    botSeller: { findUnique: jest.fn().mockResolvedValue(seller) },
    mailing: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 5, userId: 7, link: 'https://t.me/post' }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 7, telegramId: '42' }),
    },
    mailingReservation: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 1, ...data }),
        ),
    },
    lockedDays: { findFirst: jest.fn().mockResolvedValue(null) },
    mailingTargetBots: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: any) => {
        targetBots.push(data);
        return Promise.resolve({ id: 1, ...data });
      }),
    },
  };
  const balance = {
    holdBalance: jest.fn().mockImplementation((_id: string, payload: any) => {
      holds.push(payload);
      return Promise.resolve({});
    }),
  };
  const service = new ReservationService(
    prisma as any,
    configWith(),
    balance as any,
    {} as any,
  );
  return { service, prisma, balance, holds, targetBots };
}

const dto = (paymentType: string) =>
  ({
    mailingId: 5,
    sellerId: 1,
    dates: [new Date(Date.now() + 24 * 60 * 60 * 1000)],
    paymentType,
  }) as any;

describe('ReservationService pricing', () => {
  it('holds audience x config price for a per_subscriber bot', async () => {
    const { service, holds, targetBots } = setup({
      id: 1,
      link: 'https://t.me/bot',
      isChannel: false,
      fixedPrice: null,
      totalBotAudience: 1000,
    });

    await service.reserveMailingDay(dto('per_subscriber'));

    // 1000 * 0.0005 + 1000 * 0.00005
    expect(holds).toHaveLength(1);
    expect(holds[0]).toEqual(expect.objectContaining({ amount: 0.55 }));
    expect(targetBots[0]).toMatchObject({ paymentType: 'per_subscriber' });
  });

  it('holds audience x channel config price for a per_subscriber channel', async () => {
    const { service, holds } = setup({
      id: 1,
      link: 'https://t.me/channel',
      isChannel: true,
      fixedPrice: null,
      channelAudience: 1000,
    });

    await service.reserveMailingDay(dto('per_subscriber'));

    // 1000 * 0.0002 + 1000 * 0.00005
    expect(holds[0]).toEqual(expect.objectContaining({ amount: 0.25 }));
  });

  it('does not fall back to the fixed price for per_subscriber', async () => {
    const { service, holds } = setup({
      id: 1,
      link: 'https://t.me/bot',
      isChannel: false,
      fixedPrice: 100,
      totalBotAudience: 1000,
    });

    await service.reserveMailingDay(dto('per_subscriber'));

    expect(holds[0]).toEqual(expect.objectContaining({ amount: 0.55 }));
  });

  it('rejects per_subscriber without audience data instead of holding zero', async () => {
    const { service, balance } = setup({
      id: 1,
      link: 'https://t.me/bot',
      isChannel: false,
      fixedPrice: null,
      totalBotAudience: 0,
    });

    await expect(service.reserveMailingDay(dto('per_subscriber'))).rejects.toBeInstanceOf(
      PreconditionFailedException,
    );
    expect(balance.holdBalance).not.toHaveBeenCalled();
  });

  it('holds price plus percent commission for a fixed reservation', async () => {
    const { service, holds } = setup({
      id: 1,
      link: 'https://t.me/bot',
      isChannel: false,
      fixedPrice: 100,
    });

    await service.reserveMailingDay(dto('fixed'));

    expect(holds[0]).toEqual(expect.objectContaining({ amount: 110 }));
  });

  it('rejects an unsupported payment type', async () => {
    const { service } = setup({
      id: 1,
      link: 'https://t.me/bot',
      isChannel: false,
      fixedPrice: 100,
    });

    await expect(service.reserveMailingDay(dto('subscriber'))).rejects.toBeInstanceOf(
      PreconditionFailedException,
    );
  });
});
