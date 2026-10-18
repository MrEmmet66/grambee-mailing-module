import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { BalanceService } from './balance.service';

function configWith(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string, defaultValue?: unknown) =>
      key in values ? values[key] : defaultValue,
  } as unknown as ConfigService;
}

describe('BalanceService', () => {
  it('refuses to start without a configured gateway url', () => {
    expect(
      () => new BalanceService({} as any, configWith({}), {} as any),
    ).toThrow(/GATEWAY_URL/);
  });

  it('maps the gateway response into the balance DTO', async () => {
    const http = {
      get: jest
        .fn()
        .mockReturnValue(
          of({ data: { balance: 10, holdBalance: 2, availableBalance: 8 } }),
        ),
    };
    const service = new BalanceService(
      {} as any,
      configWith({ GATEWAY_URL: 'https://gw' }),
      http as any,
    );

    await expect(service.getBalance('42')).resolves.toEqual({
      currentBalance: 10,
      holdBalance: 2,
      availableBalance: 8,
    });
    expect(http.get).toHaveBeenCalledWith('https://gw/api/v1/balance/42');
  });

  it('converts gateway errors into BadRequestException', async () => {
    const http = {
      post: jest
        .fn()
        .mockReturnValue(
          throwError(() => ({ response: { data: { message: 'denied' } } })),
        ),
    };
    const service = new BalanceService(
      {} as any,
      configWith({ GATEWAY_URL: 'https://gw' }),
      http as any,
    );

    await expect(
      service.releaseBalance('42', { amount: 5 } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
