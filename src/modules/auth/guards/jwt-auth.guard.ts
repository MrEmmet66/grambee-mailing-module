import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AUTH_POLICY } from '../decorators/auth-policy.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const policy = this.reflector.getAllAndOverride<string>(AUTH_POLICY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (policy === 'public' || policy === 'service') return true;
    return super.canActivate(context);
  }
}
