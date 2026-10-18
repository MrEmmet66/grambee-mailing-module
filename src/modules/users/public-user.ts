import { Prisma, User } from '@prisma/client';

// Allowlist: new database columns never become public automatically.
export const PUBLIC_USER_SELECT = {
  id: true,
  telegramId: true,
  username: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export function toPublicUser(
  user: Pick<User, 'id' | 'telegramId' | 'username' | 'createdAt'>,
) {
  return {
    id: user.id,
    telegramId: user.telegramId,
    username: user.username,
    createdAt: user.createdAt,
  };
}
