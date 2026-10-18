import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID, createHash } from 'node:crypto';
import { User, Prisma } from '@prisma/client';
import { AuthRepository } from './repositories/auth.repository';
import { PasswordService } from './services/password.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { toPublicUser } from '../users/public-user';

export interface TokenPayload {
  sub: number;
  telegramId: string;
  type: 'access' | 'refresh';
  jti: string;
}
export const hashRefreshToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly jwtService: JwtService,
    private readonly passwords: PasswordService,
  ) {}

  async register(dto: CreateUserDto) {
    const passwordHash = await this.passwords.hash(dto.password);
    let user: User;
    try {
      user = await this.authRepository.createUser({
        telegramId: dto.telegramId,
        username: dto.username,
        passwordHash,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Account already exists');
      }
      throw error;
    }
    const tokens = await this.generateTokens(user);
    await this.authRepository.saveRefreshToken(
      user.id,
      hashRefreshToken(tokens.refreshToken),
    );
    return { user: toPublicUser(user), ...tokens };
  }

  async login(telegramId: string, password: string) {
    const user = await this.authRepository.findByTelegramId(telegramId);
    // Derive a key even for unknown accounts to avoid a cheap timing oracle.
    const valid = await this.passwords.verify(password, user?.passwordHash);
    if (!user || !valid) throw new UnauthorizedException('Invalid credentials');
    const tokens = await this.generateTokens(user);
    await this.authRepository.saveRefreshToken(
      user.id,
      hashRefreshToken(tokens.refreshToken),
    );
    return tokens;
  }

  async refreshToken(userId: number, refreshToken: string) {
    let payload: TokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<TokenPayload>(refreshToken, {
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (payload.type !== 'refresh' || !payload.jti || payload.sub !== userId) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = await this.authRepository.findById(payload.sub);
    if (!user) throw new UnauthorizedException('Invalid refresh token');
    const tokens = await this.generateTokens(user);
    // Compare and swap makes refresh single-use even for concurrent requests.
    const rotated = await this.authRepository.rotateRefreshToken(
      user.id,
      hashRefreshToken(refreshToken),
      hashRefreshToken(tokens.refreshToken),
    );
    if (!rotated) throw new UnauthorizedException('Invalid refresh token');
    return tokens;
  }

  private async generateTokens(user: Pick<User, 'id' | 'telegramId'>) {
    const payload = { sub: user.id, telegramId: user.telegramId };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...payload, type: 'access', jti: randomUUID() },
        { expiresIn: '20m' },
      ),
      this.jwtService.signAsync(
        { ...payload, type: 'refresh', jti: randomUUID() },
        { expiresIn: '30d' },
      ),
    ]);
    return { accessToken, refreshToken };
  }
}
