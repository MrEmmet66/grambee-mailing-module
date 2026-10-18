import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { PasswordService } from '../src/modules/auth/services/password.service';

// Run with the API stopped. Never log passwords or credential hashes.
async function main() {
  const prisma = new PrismaClient();
  const passwords = new PasswordService();
  let cursor = 0;
  let migrated = 0;
  try {
    for (;;) {
      const users = await prisma.user.findMany({
        where: { id: { gt: cursor } },
        orderBy: { id: 'asc' },
        take: 100,
        select: { id: true, passwordHash: true },
      });
      if (!users.length) break;
      for (const user of users) {
        cursor = user.id;
        if (passwords.isHash(user.passwordHash)) continue;
        const hash = await passwords.hash(user.passwordHash);
        const result = await prisma.user.updateMany({
          where: { id: user.id, passwordHash: user.passwordHash },
          data: { passwordHash: hash, refreshTokenHash: null },
        });
        migrated += result.count;
      }
    }
    // Old bearer tokens must not survive the rollout, including already hashed accounts.
    await prisma.user.updateMany({ data: { refreshTokenHash: null } });
    console.log(
      `Migrated ${migrated} legacy passwords; all refresh sessions revoked.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}
main().catch(() => {
  console.error(
    'Credential migration failed. Check database access; keep the API stopped and rerun.',
  );
  process.exitCode = 1;
});
