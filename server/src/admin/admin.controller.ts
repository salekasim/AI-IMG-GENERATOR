import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { clampInt } from '../common/num.util';
import { AdminService } from './admin.service';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Get('users')
  listUsers(@Query('q') q?: string, @Query('limit') limit?: string) {
    return this.admin.listUsers(q, clampInt(limit, 50, 1, 200));
  }

  @Patch('users/:id')
  updateUser(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.admin.updateUser(user.userId, id, dto);
  }

  @Get('providers')
  listProviders() {
    return this.admin.listProviders();
  }

  @Get('routing-variables')
  listRoutingVariables() {
    return this.admin.listRoutingVariables();
  }

  @Get('analytics')
  analytics(@Query('days') days?: string) {
    return this.admin.analytics(clampInt(days, 30, 1, 365));
  }

  @Patch('providers/:id')
  updateProvider(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateProviderDto,
  ) {
    return this.admin.updateProvider(user.userId, id, dto);
  }

  @Post('providers/:id/test')
  testProvider(@Param('id') id: string) {
    return this.admin.testProvider(id);
  }

  @Get('settings')
  listSettings() {
    return this.admin.listSettings();
  }

  @Patch('settings/:key')
  updateSetting(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
  ) {
    return this.admin.setSetting(user.userId, key, dto.value);
  }

  @Get('audit')
  listAudit(@Query('limit') limit?: string) {
    return this.admin.listAudit(Number(limit ?? 100));
  }

  @Delete('audit')
  async clearAudit(@CurrentUser() user: AuthUser) {
    const removed = await this.admin.clearAudit(user.userId);
    return { removed };
  }
}
