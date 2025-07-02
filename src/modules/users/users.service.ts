import { Injectable, BadRequestException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    if (!createUserDto.telegramId) {
      throw new BadRequestException('telegramId is required');
    }
    // Используем AuthService для регистрации и генерации токенов
    const { user, accessToken, refreshToken } = await this.authService.register(createUserDto);
    return { user, accessToken, refreshToken };
  }

  async findAll() {
    return this.prisma.user.findMany({
      include: {
        BotSeller: true,
      },
    });
  }

  async findOne(id: number) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        BotSeller: true,
      },
    });
  }

  async findByTelegramId(telegramId: string) {
    const user = await this.prisma.user.findUnique({
      where: { telegramId },
      include: {
        BotSeller: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with telegramId ${telegramId} not found`);
    }

    return user;

  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    return this.prisma.user.update({
      where: { id },
      data: updateUserDto,
    });
  }

  async remove(id: number) {
    return this.prisma.user.delete({
      where: { id },
    });
  }
}