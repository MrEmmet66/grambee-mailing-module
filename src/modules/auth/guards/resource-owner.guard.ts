import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AuthUser } from '../decorators/current-user.decorator';

type Resource =
  | 'user'
  | 'telegramUser'
  | 'mailing'
  | 'bot'
  | 'target'
  | 'reservation'
  | 'reservationParticipant';
type OwnerPolicy = {
  resource: Resource;
  key: string;
  source: 'params' | 'body' | 'query';
};
export const OWNER_POLICY = 'auth:owner';
export const Owns = (
  resource: Resource,
  key: string,
  source: OwnerPolicy['source'] = 'params',
) => SetMetadata(OWNER_POLICY, { resource, key, source } satisfies OwnerPolicy);

@Injectable()
export class ResourceOwnerGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.get<OwnerPolicy>(
      OWNER_POLICY,
      context.getHandler(),
    );
    if (!policy) return true;
    const request = context.switchToHttp().getRequest<{
      user: AuthUser;
      params: Record<string, unknown>;
      body: Record<string, unknown>;
      query: Record<string, unknown>;
    }>();
    const user = request.user;
    const value: unknown = request[policy.source]?.[policy.key];
    if (
      (typeof value !== 'string' && typeof value !== 'number') ||
      !/^[1-9]\d*$/.test(String(value))
    ) {
      throw new BadRequestException('Invalid resource ID');
    }
    if (policy.resource === 'telegramUser') {
      if (String(value) !== user.telegramId) throw new NotFoundException();
      return true;
    }
    const id = Number(value);
    if (!Number.isSafeInteger(id))
      throw new BadRequestException('Invalid resource ID');
    let owned: unknown;
    switch (policy.resource) {
      case 'user':
        owned = id === user.id;
        break;
      case 'mailing':
        owned = await this.prisma.mailing.findFirst({
          where: { id, userId: user.id },
          select: { id: true },
        });
        break;
      case 'bot':
        owned = await this.prisma.botSeller.findFirst({
          where: { id, userId: user.id },
          select: { id: true },
        });
        break;
      case 'target':
        owned = await this.prisma.mailingTargetBots.findFirst({
          where: { id, mailing: { userId: user.id } },
          select: { id: true },
        });
        break;
      case 'reservation':
        owned = await this.prisma.mailingReservation.findFirst({
          where: { id, mailing: { userId: user.id } },
          select: { id: true },
        });
        break;
      case 'reservationParticipant':
        owned = await this.prisma.mailingReservation.findFirst({
          where: {
            id,
            OR: [
              { mailing: { userId: user.id } },
              { botSeller: { userId: user.id } },
            ],
          },
          select: { id: true },
        });
        break;
    }
    if (!owned) throw new NotFoundException();
    return true;
  }
}
