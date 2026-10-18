import { ConfigService } from '@nestjs/config';
import { MailingPaymentService } from './payment.service';

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

type Options = {
  paymentType?: string | null;
  viewCount?: number;
  heldAmount?: number;
  fixedPrice?: number | null;
  isChannel?: boolean;
  availableBalance?: number;
};

function setup(options: Options = {}) {
  const {
    paymentType = 'per_subscriber',
    viewCount = 1000,
    heldAmount = 1,
    fixedPrice = null,
    isChannel = false,
    availableBalance = 0,
  } = options;

  const reservation = {
    id: 1,
    mailingId: 5,
    botSellerId: 2,
    date: new Date('2026-01-01'),
    heldAmount,
    isProcessed: true,
    adminApprovalStatus: 'PENDING',
    viewCount,
    mailing: { user: { telegramId: '42' } },
    botSeller: { id: 2, isChannel, fixedPrice, user: { telegramId: '77' } },
  };

  const balance = {
    getBalance: jest.fn().mockResolvedValue({
      currentBalance: availableBalance + heldAmount,
      holdBalance: heldAmount,
      availableBalance,
    }),
    withdrawBalance: jest.fn().mockResolvedValue({}),
    holdWithdrawBalance: jest.fn().mockResolvedValue({}),
    releaseBalance: jest.fn().mockResolvedValue({}),
    addBalance: jest.fn().mockResolvedValue({}),
  };

  const prisma = {
    mailingReservation: {
      findUnique: jest.fn().mockResolvedValue(reservation),
      update: jest.fn().mockResolvedValue({}),
    },
    mailingTargetBots: {
      findFirst: jest
        .fn()
        .mockResolvedValue(paymentType === null ? null : { paymentType }),
    },
  };

  const mailing = { updateChannelViews: jest.fn().mockResolvedValue({}) };
  const service = new MailingPaymentService(
    prisma as any,
    balance as any,
    configWith(),
    mailing as any,
  );
  return { service, prisma, balance, mailing };
}

describe('MailingPaymentService', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('settles per_subscriber by actual entrances and releases unused hold', async () => {
    const { service, balance, prisma } = setup({
      paymentType: 'per_subscriber',
      viewCount: 1000,
      heldAmount: 1,
    });

    const result = await service.approveMailingPayment(1);

    expect(result.entranceCount).toBe(1000);
    expect(result.totalPayment).toBeCloseTo(0.55, 10);
    expect(result.sellerAmount).toBeCloseTo(0.5, 10);
    expect(result.serviceCommission).toBeCloseTo(0.05, 10);

    expect(balance.getBalance).toHaveBeenCalledWith('42');

    const [holdCaller, holdPayload] = balance.holdWithdrawBalance.mock.calls[0];
    expect(holdCaller).toBe('42');
    expect(holdPayload.amount).toBeCloseTo(0.55, 10);

    expect(balance.withdrawBalance).not.toHaveBeenCalled();
    const [releaseCaller, releasePayload] =
      balance.releaseBalance.mock.calls[0];
    expect(releaseCaller).toBe('42');
    expect(releasePayload.amount).toBeCloseTo(0.45, 10);

    const [sellerCaller, sellerPayload] = balance.addBalance.mock.calls[0];
    expect(sellerCaller).toBe('77');
    expect(sellerPayload.amount).toBeCloseTo(0.5, 10);

    expect(prisma.mailingReservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ adminApprovalStatus: 'APPROVED' }),
      }),
    );
  });

  it('charges the missing part from the main balance when the hold is too small', async () => {
    const { service, balance } = setup({
      paymentType: 'per_subscriber',
      viewCount: 1000,
      heldAmount: 0.1,
      availableBalance: 10,
    });

    const result = await service.approveMailingPayment(1);

    expect(result.additionalCharge).toBeCloseTo(0.45, 10);
    const [, withdrawPayload] = balance.withdrawBalance.mock.calls[0];
    expect(withdrawPayload.amount).toBeCloseTo(0.45, 10);
    const [, holdPayload] = balance.holdWithdrawBalance.mock.calls[0];
    expect(holdPayload.amount).toBeCloseTo(0.1, 10);
    expect(balance.releaseBalance).not.toHaveBeenCalled();
  });

  it('refuses to settle when neither the hold nor the main balance covers it', async () => {
    const { service, balance, prisma } = setup({
      paymentType: 'per_subscriber',
      viewCount: 1000,
      heldAmount: 0.1,
      availableBalance: 0,
    });

    await expect(service.approveMailingPayment(1)).rejects.toThrow(
      /Insufficient balance/,
    );
    expect(balance.addBalance).not.toHaveBeenCalled();
    expect(prisma.mailingReservation.update).not.toHaveBeenCalled();
  });

  it('settles a fixed mailing with a percent commission', async () => {
    const { service, balance } = setup({
      paymentType: 'fixed',
      viewCount: 1000,
      heldAmount: 110,
      fixedPrice: 100,
    });

    const result = await service.approveMailingPayment(1);

    expect(result.totalPayment).toBe(110);
    expect(result.sellerAmount).toBe(100);
    expect(result.serviceCommission).toBe(10);
    const [, holdPayload] = balance.holdWithdrawBalance.mock.calls[0];
    expect(holdPayload.amount).toBe(110);
    expect(balance.releaseBalance).not.toHaveBeenCalled();
  });

  it('treats a missing target bot record as the schema default (fixed)', async () => {
    const { service } = setup({
      paymentType: null,
      heldAmount: 110,
      fixedPrice: 100,
    });

    const result = await service.approveMailingPayment(1);

    expect(result.totalPayment).toBe(110);
  });

  it('refuses to pay on an unknown payment type instead of guessing', async () => {
    const { service, balance } = setup({
      paymentType: 'weird',
      heldAmount: 1,
      fixedPrice: 100,
    });

    await expect(service.approveMailingPayment(1)).rejects.toThrow(
      /Unsupported payment type/,
    );
    expect(balance.addBalance).not.toHaveBeenCalled();
  });
});
