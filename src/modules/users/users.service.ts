import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateUserDto } from './dto';
import { AuthService } from '../auth/auth.service';
import { PUBLIC_USER_SELECT } from './public-user';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}
  create(dto: CreateUserDto) {
    return this.authService.register(dto);
  }
  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: PUBLIC_USER_SELECT,
    });
    if (!user) throw new NotFoundException();
    return user;
  }
  async findByTelegramId(telegramId: string) {
    const user = await this.prisma.user.findUnique({
      where: { telegramId },
      select: PUBLIC_USER_SELECT,
    });
    if (!user) throw new NotFoundException();
    return user;
  }
}
