import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';

@Injectable()
export class SecretKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const supplied: unknown = request.headers['x-request-secret'];
    const expected = this.configService.get<string>('SECRET_KEY');
    if (
      typeof supplied !== 'string' ||
      !expected ||
      !timingSafeEqual(
        createHash('sha256').update(supplied).digest(),
        createHash('sha256').update(expected).digest(),
      )
    ) {
      throw new UnauthorizedException('Invalid service credentials');
    }
    return true;
  }
}
