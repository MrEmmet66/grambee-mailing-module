import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthRepository } from '../repositories/auth.repository';
import { TokenPayload } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly authRepository: AuthRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
    });
  }
  async validate(payload: TokenPayload) {
    if (
      payload.type !== 'access' ||
      !Number.isSafeInteger(payload.sub) ||
      payload.sub < 1 ||
      !payload.jti
    ) {
      throw new UnauthorizedException();
    }
    const user = await this.authRepository.findById(payload.sub);
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id,
      telegramId: user.telegramId,
      username: user.username,
    };
  }
}
