import { Injectable, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthRepository } from './repositories/auth.repository';
import { RegisterDto } from './dto/register.dto';
import { Logger } from '@nestjs/common';
import { ExternalServicesService } from './services/external-services.service';
import * as crypto from 'crypto';
import { CreateUserDto } from '../users';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly jwtService: JwtService,
  ) {}

  async register(registerDto: CreateUserDto) {
    this.logger.log(`Registering new user with telegramId: ${registerDto.telegramId}`);
    // Проверка на существование пользователя
    const existing = await this.authRepository.findByTelegramId(registerDto.telegramId);
    if (existing) {
      throw new ConflictException('User with this telegramId already exists');
    }
    // Создаём пользователя
    const user = await this.authRepository.createUser({
      telegramId: registerDto.telegramId,
      username: registerDto.username,
      passwordHash: registerDto.password
    });
    // Генерируем токены
    const tokens = await this.generateTokens(user);
    await this.authRepository.saveRefreshToken(user.id, tokens.refreshToken);
    return { user, ...tokens };
  }

  async authenticateByTelegramId(telegramId: string, password: string) {

  }

  async findByTelegramId(telegramId: number) {
    this.logger.log(`Finding user by telegramId: ${telegramId}`);
    return this.authRepository.findByTelegramId(String(telegramId));
  }

  async login(telegramId: string, password: string) {
    const user = await this.authRepository.findByTelegramId(telegramId);
    if (!user) {
      throw new Error('User not found');
    }
    if (!this.validatePassword(password, user.passwordHash)) { throw new Error('Invalid password'); }

    const tokens = await this.generateTokens(user);
    await this.authRepository.saveRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  async refreshToken(userId: number, refreshToken: string) {
    const user = await this.authRepository.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    const isValid = await this.authRepository.validateRefreshToken(userId, refreshToken);
    if (!isValid) {
      throw new Error('Invalid refresh token');
    }
    const tokens = await this.generateTokens(user);
    await this.authRepository.saveRefreshToken(userId, tokens.refreshToken);
    return tokens;
  }

  validatePassword(passwordHashInput: string, passwordHash: string): boolean {
    if (!passwordHashInput || !passwordHash) return false;
    return passwordHashInput === passwordHash;
  }

  private async generateTokens(user: any) {
    const payload = {
      sub: user.id,
      telegramId: user.telegramId.toString(),
    };
    const accessToken = this.jwtService.sign(payload, {
      secret: this.jwtService['options'].secret,
      expiresIn: '15m',
    });
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.jwtService['options'].secret,
      expiresIn: '30d',
    });
    return { accessToken, refreshToken };
  }


}