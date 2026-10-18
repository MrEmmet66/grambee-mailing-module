import { PUBLIC_USER_SELECT } from '../../users/public-user';
/*
https://docs.nestjs.com/providers#services
*/

import {
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotAcceptableException,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import {
  CreateMailingDto,
  CreateMailingFormData,
  UpdateMailingContentFormData,
  UpdateTargetBotContentFormData,
} from '../dto/createMailing.dto';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TelegramService } from '../../telegram/telegram.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as readline from 'readline';
import { setTimeout } from 'timers/promises';
import { Application } from 'express';
import { ApplicationSendersService } from '../../telegram/applications-sender.service';
import { MailingNotifyProps } from '../../telegram/telegram.types';
import { mkdirSync } from 'fs';
import {
  BotSeller,
  MailingReservation,
  MailingTargetBots,
} from '@prisma/client';
import { BalanceService } from '../../balance/balance.service';
import { ReservationService } from './reservation.service';
import { ProcessorService } from './processor.service';
import { resolveTelegramTargets } from '../../telegram/telegram-targets';

@Injectable()
export class MailingService {
  private readonly logger = new Logger(MailingService.name);
  constructor(
    private readonly prismaService: PrismaService,
    @Inject(forwardRef(() => ApplicationSendersService))
    private applicationsService: ApplicationSendersService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    private readonly balanceService: BalanceService,
    private httpService: HttpService,
    private configService: ConfigService,
    private readonly reservationService: ReservationService,
    private readonly processorService: ProcessorService, // добавляем зависимость
  ) {}
  async getMailingOwnerTelegramId(mailingId: number) {
    const mailing = await this.prismaService.mailing.findUnique({
      where: { id: mailingId },
      include: { user: { select: PUBLIC_USER_SELECT } },
    });

    if (!mailing) {
      throw new NotFoundException(`Mailing with ID ${mailingId} not found`);
    }

    return mailing.user.telegramId;
  }

  async getMailingByReservationId(reservationId: number) {
    const reservation = await this.prismaService.mailingReservation.findUnique({
      where: { id: reservationId },
      include: { mailing: true },
    });

    if (!reservation) {
      throw new NotFoundException(
        `Reservation with ID ${reservationId} not found`,
      );
    }

    return reservation.mailing;
  }

  async getMailingTargetBots(mailingId: number): Promise<MailingTargetBots[]> {
    const targetBots = await this.prismaService.mailingTargetBots.findMany({
      where: { mailingId: mailingId },
      include: {
        botSeller: true,
      },
    });

    if (!targetBots) {
      throw new NotFoundException(
        `No target bots found for mailing ID ${mailingId}`,
      );
    }

    return targetBots;
  }

  async getMailingOwner(mailingId: number) {
    const mailing = await this.prismaService.mailing.findUnique({
      where: { id: mailingId },
      include: { user: { select: PUBLIC_USER_SELECT } },
    });
    if (!mailing) {
      throw new NotFoundException(`Mailing with ID ${mailingId} not found`);
    }
    return mailing.user;
  }

  async isUserOwningMailing(
    userTelegramId: string,
    mailingId: number,
  ): Promise<boolean> {
    const mailing = await this.prismaService.mailing.findUnique({
      where: { id: mailingId },
      include: { user: { select: PUBLIC_USER_SELECT } },
    });
    return mailing?.user.telegramId === userTelegramId;
  }

  async deleteMailing(mailingId: number) {
    const mailing = await this.prismaService.mailing.findUnique({
      where: { id: mailingId },
    });

    if (!mailing) {
      throw new NotFoundException(`Mailing with ID ${mailingId} not found`);
    }

    if (mailing.isActive) {
      throw new ConflictException(
        `Mailing with ID ${mailingId} is active and cannot be deleted`,
      );
    }

    const futureMailingReservations =
      await this.prismaService.mailingReservation.findMany({
        where: {
          mailingId: mailingId,
          isProcessed: false,
          date: { gt: new Date() },
        },
      });

    if (futureMailingReservations.length > 0) {
      throw new PreconditionFailedException(
        `Рассылка забронирована на будущее и не может быть удалена`,
      );
    }

    // Delete all reservations for this mailing
    await this.prismaService.mailingReservation.deleteMany({
      where: { mailingId: mailingId },
    });

    await this.prismaService.mailingTargetBots.deleteMany({
      where: { mailingId: mailingId },
    });

    // Delete the mailing itself
    return await this.prismaService.mailing.delete({
      where: { id: mailingId },
    });
  }
  async updateMailingContent(
    mailingId: number,
    updateData: UpdateMailingContentFormData,
  ) {
    return await this.prismaService.mailing.update({
      where: { id: mailingId },
      data: {
        postContent: updateData.content,
        postMediaType: updateData.mediaType,
        postMedia: updateData.media
          ? `/uploads/${updateData.media.filename}`
          : null,
        postButtons: updateData.buttons, // Store buttons as JSON string
      },
    });
  }

  async getMailingByTargetBot(targetBotId: number) {
    return await this.prismaService.mailing.findFirst({
      where: { MailingTargetBots: { some: { id: targetBotId } } },
    });
  }

  async updateMailingTargetBotContent(
    targetBotId: number,
    updateData: UpdateTargetBotContentFormData,
  ) {
    const targetBot = await this.prismaService.mailingTargetBots.findUnique({
      where: { id: targetBotId },
    });

    if (!targetBot) {
      throw new NotFoundException(
        `Target bot with ID ${targetBotId} not found`,
      );
    }

    // If there was a previous media file and it's being replaced, delete the old file
    if (targetBot.postMedia && updateData.media) {
      const oldPath = targetBot.postMedia.startsWith('/uploads/')
        ? targetBot.postMedia
        : `/uploads/${targetBot.postMedia}`;
      const fullPath = require('path').join(process.cwd(), oldPath);
      const fs = require('fs');
      if (fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
        } catch (e) {
          this.logger?.warn?.(`Failed to delete old media file: ${fullPath}`);
        }
      }
    }

    // Only update postMedia if new media is provided
    const updatePayload: any = {
      postContent: updateData.content,
      postMediaType: updateData.mediaType,
      postButtons: updateData.buttons, // Store buttons as JSON string
    };
    if (updateData.media) {
      updatePayload.postMedia = `/uploads/${updateData.media.filename}`;
    }

    if (updateData.link) {
      updatePayload.postLink = updateData.link;
    }

    return await this.prismaService.mailingTargetBots.update({
      where: { id: targetBotId },
      data: updatePayload,
      include: {
        botSeller: true,
      },
    });
  }

  async updateMailingReservationForwardedMessage(
    reservationId: number,
    messageId: number,
  ) {
    const reservation = await this.prismaService.mailingReservation.findUnique({
      where: { id: reservationId },
    });

    if (!reservation) {
      throw new NotFoundException(
        `Reservation with ID ${reservationId} not found`,
      );
    }

    return await this.prismaService.mailingReservation.update({
      where: { id: reservationId },
      data: {
        forwardedMessageId: String(messageId), // Store as string to avoid issues with large numbers
      },
    });
  }

  async getMailingTargetBot(
    mailingId: number,
    botSellerId: number,
  ): Promise<MailingTargetBots | null> {
    const mailingTargetBot =
      await this.prismaService.mailingTargetBots.findFirst({
        where: {
          mailingId: mailingId,
          botSellerId: botSellerId,
        },
      });

    return mailingTargetBot;
  }

  async getMailingById(mailingId: number) {
    const mailing = await this.prismaService.mailing.findUnique({
      where: {
        id: mailingId,
      },
    });

    if (!mailing) {
      throw new NotFoundException(`Mailing with ID ${mailingId} not found`);
    }

    return mailing;
  }

  async createMailing(dto: CreateMailingDto) {
    this.logger.log(
      `Creating mailing with data: ${JSON.stringify({
        userId: dto.userId,
        link: dto.link,
        hasMedia: !!dto.media,
        contentLength: dto.content?.length || 0,
        buttons: Array.isArray(dto.buttons) ? dto.buttons : [dto.buttons],
      })}`,
    );

    // Resolve the internal account ID supplied by the authenticated controller.
    const user = await this.prismaService.user.findFirst({
      where: {
        id: dto.userId,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${dto.userId} not found`);
    }

    // If there's a media file, use its path
    const mediaPath = dto.media ? `/uploads/${dto.media.filename}` : null;

    try {
      const existingMailing = await this.prismaService.mailing.findFirst({
        where: {
          OR: [...(dto.link ? [{ link: dto.link }] : [])],
        },
      });

      if (existingMailing) {
        this.logger.warn(
          `Mailing with the same botToken, channelId or botLink already exists`,
        );
        throw new ConflictException(
          `Mailing with the same botToken, channelId or botLink already exists`,
        );
      }

      // Store button array directly
      const mailing = await this.prismaService.mailing.create({
        data: {
          userId: user.id,
          link: dto.link || '',
          postContent: dto.content,
          postMediaType: dto.mediaType,
          postMedia: mediaPath,
          postButtons: Array.isArray(dto.buttons) ? dto.buttons : [dto.buttons],
          status: 'PENDING',
        },
      });

      this.logger.log(`Mailing created with ID: ${mailing.id}`);

      // Send application to Telegram
      await this.applicationsService.sendMailingApplication(mailing);

      return mailing;
    } catch (error) {
      this.logger.error(`Error creating mailing: ${error.message}`);
      throw error;
    }
  }

  async getUserMailings(userId: number) {
    this.logger.log(`Getting mailings for user ID: ${userId}`);

    return await this.prismaService.mailing.findMany({
      where: {
        user: { telegramId: String(userId) }, // Support both ID and Telegram ID
      },
      include: {
        user: { select: PUBLIC_USER_SELECT },
      },
    });
  }

  async getAllMailings() {
    return await this.prismaService.mailing.findMany({
      include: {
        user: { select: PUBLIC_USER_SELECT },
        _count: {
          select: {
            MailingTargetBots: true,
            mailingReservations: true,
          },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
  }

  async toggleMailingStatus(mailingId: number) {
    const mailing = await this.prismaService.mailing.findUnique({
      where: {
        id: mailingId,
      },
      include: {
        user: { select: PUBLIC_USER_SELECT },
      },
    });

    if (!mailing) {
      throw new NotFoundException('Mailing not found');
    }

    const mailingReservations =
      await this.prismaService.mailingReservation.findMany({
        where: {
          mailingId: mailingId,
        },
        include: {
          botSeller: true,
        },
      });

    if (mailingReservations.length === 0) {
      throw new ConflictException('No reservations found for this mailing');
    }

    if (mailing.isActive) {
      throw new ConflictException('Mailing is already active');
    }
    return await this.prismaService.mailing.update({
      where: {
        id: mailingId,
      },
      data: {
        isActive: !mailing.isActive,
      },
    });
  }
  async processMailing(reservation) {
    return this.processorService.processMailing(reservation);
  }

  async getMessageViews(chatId: string, messageId: string): Promise<number> {
    const telethonClientUrl = this.configService.get<string>(
      'TELETHON_CLIENT_URL',
      'http://localhost:8000',
    );
    const url = `${telethonClientUrl}/views_by_forward?forward_chat_id=${chatId}&forward_message_id=${messageId}`;

    try {
      const response = await this.httpService.get(url).toPromise();
      if (!response || response.status !== 200) {
        this.logger.error(
          `Failed to fetch message views: ${response ? response.statusText : 'No response'}`,
        );
        throw new InternalServerErrorException(
          `Failed to fetch message views: ${response ? response.statusText : 'No response'}`,
        );
      }
      return response.data?.views || 0;
    } catch (error) {
      this.logger.error(`Error fetching message views: ${error.message}`);
      throw error;
    }
  }

  async updateChannelViews(reservation: MailingReservation) {
    const { adminChatId: chatId } = resolveTelegramTargets(this.configService);
    if (!reservation.forwardedMessageId) {
      this.logger.warn(
        `Reservation ${reservation.id} does not have a forwarded message ID`,
      );
      return;
    }

    const messageId = reservation.forwardedMessageId;
    const views = await this.getMessageViews(chatId, messageId);
    this.logger.log(`Message ${messageId} has ${views} views`);

    if (views > reservation.viewCount) {
      await this.prismaService.mailingReservation.update({
        where: {
          id: reservation.id,
        },
        data: {
          viewCount: views,
        },
      });
    }
  }
}
