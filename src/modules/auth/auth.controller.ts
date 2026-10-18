import { Controller, Post, Body, Get, UseGuards, Param, Logger, Delete } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Login by telegramId and password' })
  async login(@Body() body: { telegramId: string; password: string }) {
    const tokens = await this.authService.login(body.telegramId, body.password);
    return tokens;
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token by refresh token' })
  async refresh(@Body() body: { userId: number; refreshToken: string }) {
    const tokens = await this.authService.refreshToken(body.userId, body.refreshToken);
    return tokens;
  }
}