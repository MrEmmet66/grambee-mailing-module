import { Injectable, Logger } from '@nestjs/common';

import { RegisterDto } from '../dto/register.dto';
import { PrismaService } from 'prisma/prisma.service';

@Injectable()
export class AuthRepository {
  private readonly logger = new Logger(AuthRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByTelegramId(telegramId: string) {
    this.logger.log(`Finding user by telegramId: ${telegramId}`);
    try {
      return this.prisma.user.findUnique({
        where: { telegramId: String(telegramId) }
      });
    } catch (error) {
      this.logger.error(`Error finding user by telegramId ${telegramId}: ${error.message}`);
      throw error;
    }
  }

  async findById(id: number) {
    this.logger.log(`Finding user by id: ${id}`);
    try {
      return this.prisma.user.findUnique({ where: { id } });
    } catch (error) {
      this.logger.error(`Error finding user by id ${id}: ${error.message}`);
      throw error;
    }
  }

  async saveRefreshToken(userId: number, refreshToken: string) {
    this.logger.log(`Saving refreshToken for userId: ${userId}`);
    try {
      // Найти пользователя по id, получить telegramId
      const user = await this.prisma.user.findUnique({ where: { telegramId: String(userId) } });
      if (!user) throw new Error(`User with id ${userId} not found`);
      return this.prisma.user.update({
        where: { telegramId: user.telegramId },
        data: { refreshToken }
      });
    } catch (error) {
      this.logger.error(`Error saving refreshToken for userId ${userId}: ${error.message}`);
      throw error;
    }
  }

  async validateRefreshToken(userId: number, refreshToken: string) {
    this.logger.log(`Validating refreshToken for userId: ${userId}`);
    try {
      // Найти пользователя по id, получить telegramId
      const user = await this.prisma.user.findUnique({ where: { telegramId: String(userId) } });
      if (!user) return false;
      const userByTelegram = await this.prisma.user.findUnique({ where: { telegramId: user.telegramId } });
      return userByTelegram && userByTelegram.refreshToken === refreshToken;
    } catch (error) {
      this.logger.error(`Error validating refreshToken for userId ${userId}: ${error.message}`);
      throw error;
    }
  }

  async createUser(data: { telegramId: string; username?: string; passwordHash: string }) {
    this.logger.log(`Creating user with telegramId: ${data.telegramId}`);
    try {
      return this.prisma.user.create({
        data: {
          telegramId: data.telegramId,
          username: data.username,
          passwordHash: data.passwordHash,
        },
      });
    } catch (error) {
      this.logger.error(`Error creating user: ${error.message}`);
      throw error;
    }
  }
}