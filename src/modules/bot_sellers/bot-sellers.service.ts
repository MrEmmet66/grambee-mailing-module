import { Injectable, BadRequestException } from '@nestjs/common';
import { CreateBotSellerDto, UpdateBotSellerDto } from './dto';
import { PrismaService } from 'prisma/prisma.service';

@Injectable()
export class BotSellersService {
  constructor(private prisma: PrismaService) {}

  async create(createBotSellerDto: CreateBotSellerDto) {
    // Проверяем существование пользователя
    const userExists = await this.prisma.user.findUnique({
      where: { id: createBotSellerDto.userId }
    });

    if (!userExists) {
      throw new BadRequestException(`User with id ${createBotSellerDto.userId} not found`);
    }

    return this.prisma.botSeller.create({
      data: createBotSellerDto,
    });
  }

  async findAll() {
    return this.prisma.botSeller.findMany({
      include: {
        user: true,
      },
    });
  }

  async findOne(id: number) {
    return this.prisma.botSeller.findUnique({
      where: { id },
      include: {
        user: true,
        mailingReservations: true,
      },
    });
  }

  async update(id: number, updateBotSellerDto: UpdateBotSellerDto) {
    return this.prisma.botSeller.update({
      where: { id },
      data: updateBotSellerDto,
    });
  }

  async remove(id: number) {
    return this.prisma.botSeller.delete({
      where: { id },
    });
  }

  async findByUserId(userId: number) {
    return this.prisma.botSeller.findMany({
      where: { userId },
      include: {
        user: true,
      },
    });
  }

  async updateStatus(id: number, acceptStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WAITING') {
    return this.prisma.botSeller.update({
      where: { id },
      data: { acceptStatus },
    });
  }

  async updateStatistics(id: number, statistics: {
    botLiveAudience?: number;
    botMonthlyActiveUsers?: number;
    channelAudience?: number;
    channelDaylyActiveUsers?: number;
  }) {
    return this.prisma.botSeller.update({
      where: { id },
      data: statistics,
    });
  }
} 