import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}
  findByTelegramId(telegramId: string) {
    return this.prisma.user.findUnique({ where: { telegramId } });
  }
  findById(id: number) {
    return this.prisma.user.findUnique({ where: { id } });
  }
  saveRefreshToken(id: number, refreshToken: string) {
    return this.prisma.user.update({
      where: { id },
      data: { refreshTokenHash: refreshToken },
    });
  }
  async rotateRefreshToken(id: number, previousHash: string, nextHash: string) {
    const result = await this.prisma.user.updateMany({
      where: { id, refreshTokenHash: previousHash },
      data: { refreshTokenHash: nextHash },
    });
    return result.count === 1;
  }
  createUser(data: {
    telegramId: string;
    username?: string;
    passwordHash: string;
  }) {
    return this.prisma.user.create({ data });
  }
}
