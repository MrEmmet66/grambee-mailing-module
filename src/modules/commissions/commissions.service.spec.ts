import { PrismaService } from 'prisma/prisma.service';
import { CommissionsService } from './commissions.service';

function serviceWithAggregate(aggregate: jest.Mock): CommissionsService {
  const prisma = {
    mailingReservation: { aggregate },
  } as unknown as PrismaService;
  return new CommissionsService(prisma);
}

describe('CommissionsService', () => {
  it('returns held minus paid for a mailing', async () => {
    const aggregate = jest
      .fn()
      .mockResolvedValue({ _sum: { heldAmount: 100, paidAmount: 70 } });

    await expect(
      serviceWithAggregate(aggregate).getMailingCommissions(
        1,
        undefined,
        undefined,
      ),
    ).resolves.toBe(30);
  });

  it('treats missing sums as zero', async () => {
    const aggregate = jest
      .fn()
      .mockResolvedValue({ _sum: { heldAmount: null, paidAmount: null } });

    await expect(
      serviceWithAggregate(aggregate).getTotalCommissions(undefined, undefined),
    ).resolves.toBe(0);
  });

  it('filters by processedAt when a date range is provided', async () => {
    const aggregate = jest
      .fn()
      .mockResolvedValue({ _sum: { heldAmount: 50, paidAmount: 20 } });
    const from = new Date('2025-01-01');
    const to = new Date('2025-02-01');

    await serviceWithAggregate(aggregate).getUserCommissions(7, from, to);

    expect(aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { processedAt: { gte: from, lte: to }, mailing: { userId: 7 } },
      }),
    );
  });

  it('does not filter by date when the range is incomplete', async () => {
    const aggregate = jest
      .fn()
      .mockResolvedValue({ _sum: { heldAmount: 10, paidAmount: 0 } });

    await serviceWithAggregate(aggregate).getUserCommissions(
      7,
      new Date(),
      undefined,
    );

    expect(aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { mailing: { userId: 7 } } }),
    );
  });
});
