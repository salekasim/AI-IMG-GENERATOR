import { Controller, Get, UseGuards } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UsageService } from './usage.service';

@Controller('usage')
@UseGuards(JwtAuthGuard)
export class UsageController {
  constructor(
    private readonly usage: UsageService,
    private readonly users: UsersService,
  ) {}

  @Get('me')
  async myUsage(@CurrentUser() user: AuthUser) {
    const account = await this.users.findById(user.userId);
    if (!account) {
      return { usedToday: 0, quota: 0, remaining: 0 };
    }
    return this.usage.myUsage(account.id, account.dailyQuota);
  }
}
