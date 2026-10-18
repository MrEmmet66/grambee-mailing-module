import { SetMetadata, applyDecorators, UseGuards } from '@nestjs/common';
import { SecretKeyGuard } from '../guards/secretKey.guard';

export const AUTH_POLICY = 'auth:policy';
export const TOKEN_RESPONSE = 'auth:token-response';
export const Public = () => SetMetadata(AUTH_POLICY, 'public');
export const ServiceOnly = () =>
  applyDecorators(
    SetMetadata(AUTH_POLICY, 'service'),
    UseGuards(SecretKeyGuard),
  );
export const TokenResponse = () => SetMetadata(TOKEN_RESPONSE, true);
