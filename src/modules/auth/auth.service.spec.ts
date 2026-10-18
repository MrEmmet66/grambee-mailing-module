import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { AuthService, TokenPayload, hashRefreshToken } from './auth.service';
import { AuthRepository } from './repositories/auth.repository';
import { PasswordService } from './services/password.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { ConfigService } from '@nestjs/config';

describe('AuthService token lifecycle', () => {
  const secret = 'test-secret-with-at-least-32-characters';
  const jwt = new JwtService({ secret });
  const passwords = {
    hash: jest.fn().mockResolvedValue('scrypt-hash'),
    verify: jest.fn().mockResolvedValue(true),
  };
  const user = {
    id: 7,
    telegramId: '987654321',
    username: 'demo',
    createdAt: new Date(),
    passwordHash: 'scrypt-hash',
    refreshTokenHash: null,
  };
  let currentHash: string | null;
  const repository = {
    createUser: jest.fn(),
    findByTelegramId: jest.fn(),
    findById: jest.fn(),
    saveRefreshToken: jest.fn((_id: number, hash: string) => {
      currentHash = hash;
      return Promise.resolve();
    }),
    rotateRefreshToken: jest.fn(
      (_id: number, previous: string, next: string) => {
        if (currentHash !== previous) return Promise.resolve(false);
        currentHash = next;
        return Promise.resolve(true);
      },
    ),
  };
  const service = new AuthService(
    repository as unknown as AuthRepository,
    jwt,
    passwords as unknown as PasswordService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    currentHash = null;
    repository.createUser.mockResolvedValue(user);
    repository.findByTelegramId.mockResolvedValue(user);
    repository.findById.mockResolvedValue(user);
    passwords.verify.mockResolvedValue(true);
  });

  it('hashes on registration, uses the internal ID, and returns only public user fields', async () => {
    const result = await service.register({
      telegramId: user.telegramId,
      password: 'long-test-password',
    });
    expect(repository.createUser).toHaveBeenCalledWith({
      telegramId: user.telegramId,
      username: undefined,
      passwordHash: 'scrypt-hash',
    });
    expect(repository.saveRefreshToken).toHaveBeenCalledWith(
      7,
      hashRefreshToken(result.refreshToken),
    );
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.user).not.toHaveProperty('refreshTokenHash');
    expect(currentHash).not.toBe(result.refreshToken);
  });

  it('returns 409 for a database uniqueness race', async () => {
    repository.createUser.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6',
      }),
    );
    await expect(
      service.register({
        telegramId: user.telegramId,
        password: 'long-test-password',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns the same 401 for unknown users and wrong passwords', async () => {
    repository.findByTelegramId.mockResolvedValueOnce(null);
    await expect(service.login('missing', 'bad')).rejects.toThrow(
      'Invalid credentials',
    );
    expect(passwords.verify).toHaveBeenCalledWith('bad', undefined);
    passwords.verify.mockResolvedValueOnce(false);
    await expect(service.login(user.telegramId, 'bad')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('issues unique tokens even within the same second, with distinct token types and TTLs', async () => {
    const first = await service.login(user.telegramId, 'password');
    const second = await service.login(user.telegramId, 'password');
    expect(first.refreshToken).not.toBe(second.refreshToken);
    const access = jwt.verify<TokenPayload & { exp: number; iat: number }>(
      first.accessToken,
    );
    const refresh = jwt.verify<TokenPayload & { exp: number; iat: number }>(
      first.refreshToken,
    );
    expect(access.type).toBe('access');
    expect(refresh.type).toBe('refresh');
    expect(access.exp - access.iat).toBe(1200);
    expect(refresh.exp - refresh.iat).toBe(2592000);
  });

  it('rotates refresh tokens atomically and rejects replay and concurrent reuse', async () => {
    const initial = await service.login(user.telegramId, 'password');
    const results = await Promise.allSettled([
      service.refreshToken(7, initial.refreshToken),
      service.refreshToken(7, initial.refreshToken),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    await expect(
      service.refreshToken(7, initial.refreshToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects access, expired, tampered tokens and a mismatched user ID', async () => {
    const initial = await service.login(user.telegramId, 'password');
    const expired = jwt.sign(
      { sub: 7, type: 'refresh', jti: 'expired' },
      { expiresIn: -1 },
    );
    for (const token of [initial.accessToken, expired, 'tampered']) {
      await expect(service.refreshToken(7, token)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    await expect(
      service.refreshToken(8, initial.refreshToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts only access tokens at the Passport boundary', async () => {
    const strategy = new JwtStrategy(
      new ConfigService({ JWT_SECRET: secret }),
      repository as unknown as AuthRepository,
    );
    const tokens = await service.login(user.telegramId, 'password');
    await expect(
      strategy.validate(jwt.verify<TokenPayload>(tokens.accessToken)),
    ).resolves.toMatchObject({ id: 7 });
    await expect(
      strategy.validate(jwt.verify<TokenPayload>(tokens.refreshToken)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      strategy.validate({ sub: 7, telegramId: user.telegramId } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
