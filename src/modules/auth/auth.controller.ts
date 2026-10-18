import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { Public, TokenResponse } from './decorators/auth-policy.decorator';
import { LoginDto, RefreshTokenDto } from './dto/login.dto';

@ApiTags('Authentication')
@UseGuards(ThrottlerGuard)
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @TokenResponse()
  @Post('login')
  @ApiOperation({ summary: 'Login by telegramId and password' })
  login(@Body() body: LoginDto) {
    return this.authService.login(body.telegramId, body.password);
  }

  @Public()
  @TokenResponse()
  @Post('refresh')
  @ApiOperation({
    summary: 'Rotate refresh token; userId is the internal account ID',
  })
  refresh(@Body() body: RefreshTokenDto) {
    return this.authService.refreshToken(body.userId, body.refreshToken);
  }
}
