import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map } from 'rxjs';
import { TOKEN_RESPONSE } from './decorators/auth-policy.decorator';

const PRIVATE_FIELDS = new Set([
  'password',
  'passwordHash',
  'refreshTokenHash',
  'botToken',
  'usersData',
  'statisticsFilePath',
  'accessToken',
  'refreshToken',
]);

// Defense in depth for legacy service responses. User queries also use an explicit allowlist.
export function sanitizeResponse(
  value: unknown,
  tokenResponse = false,
  depth = 0,
): unknown {
  if (Array.isArray(value))
    return value.map((item) => sanitizeResponse(item, false, depth + 1));
  if (
    value === null ||
    typeof value !== 'object' ||
    value instanceof Date ||
    Buffer.isBuffer(value)
  )
    return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !PRIVATE_FIELDS.has(key) ||
          (tokenResponse &&
            depth === 0 &&
            (key === 'accessToken' || key === 'refreshToken')),
      )
      .map(([key, item]) => [key, sanitizeResponse(item, false, depth + 1)]),
  );
}

@Injectable()
export class SensitiveResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const tokenResponse =
      this.reflector.get<boolean>(TOKEN_RESPONSE, context.getHandler()) ===
      true;
    return next
      .handle()
      .pipe(map((value) => sanitizeResponse(value, tokenResponse)));
  }
}
