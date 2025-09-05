import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SecretKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const secretKeyFromHeader = request.headers['x-request-secret'];
    const secretKeyFromEnv = this.configService.get<string>('SECRET_KEY');

    if (!secretKeyFromHeader || secretKeyFromHeader !== secretKeyFromEnv) {
      throw new UnauthorizedException('Invalid secret key');
    }

    return true;
  }
}