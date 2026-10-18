import { ThrottlerGuard } from '@nestjs/throttler';
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto';
import {
  ServiceOnly,
  TokenResponse,
} from '../auth/decorators/auth-policy.decorator';
import { Owns } from '../auth/guards/resource-owner.guard';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // A trusted gateway must verify Telegram ownership before provisioning an account.
  @UseGuards(ThrottlerGuard)
  @ServiceOnly()
  @TokenResponse()
  @Post()
  @ApiOperation({
    summary:
      'Provision a verified Telegram user (service credentials required)',
  })
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Owns('user', 'id')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  @Owns('telegramUser', 'telegramId')
  @Get('telegram/:telegramId')
  findByTelegramId(@Param('telegramId') telegramId: string) {
    return this.usersService.findByTelegramId(telegramId);
  }
}
