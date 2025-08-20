import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['authorization']; // ожидаем просто ключ в header

    if (!apiKey || apiKey !== process.env.SECRET_KEY) {
      throw new UnauthorizedException('Invalid or missing API key');
    }

    return true;
  }
}
