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
import {
  CreateProviderDto,
  CreateProviderModelDto,
  UpdateProviderModelDto,
} from './dto/create-provider.dto';
import { CreateRouteDto, UpdateRouteDto } from './dto/route.dto';
import { CreateCredentialDto } from './dto/route.dto';
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

  @Post('providers')
  createProvider(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProviderDto,
  ) {
    return this.admin.createProvider(user.userId, dto);
  }

  @Post('providers/:id/models')
  createModel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateProviderModelDto,
  ) {
    return this.admin.createModel(user.userId, id, dto);
  }

  @Patch('providers/:id/models/:modelId')
  updateModel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('modelId') modelId: string,
    @Body() dto: UpdateProviderModelDto,
  ) {
    return this.admin.updateModel(user.userId, id, modelId, dto);
  }

  @Delete('providers/:id/models/:modelId')
  deleteModel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('modelId') modelId: string,
  ) {
    return this.admin.deleteModel(user.userId, id, modelId);
  }

  @Get('analytics')
  analytics(@Query('days') days?: string) {
    return this.admin.analytics(clampInt(days, 30, 1, 365));
  }

  // ── Model routes (fallback groups) ─────────────────────────────────────
  @Get('routes')
  listRoutes() {
    return this.admin.listRoutes();
  }

  @Post('routes')
  createRoute(@CurrentUser() user: AuthUser, @Body() dto: CreateRouteDto) {
    return this.admin.createRoute(user.userId, dto);
  }

  @Patch('routes/:id')
  updateRoute(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateRouteDto) {
    return this.admin.updateRoute(user.userId, id, dto);
  }

  @Delete('routes/:id')
  async deleteRoute(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const removed = await this.admin.deleteRoute(user.userId, id);
    return { removed };
  }

  // ── Provider credentials (key pool / rotation) ─────────────────────────
  @Post('providers/:id/credentials')
  createCredential(
    @CurrentUser() user: AuthUser,
    @Param('id') providerId: string,
    @Body() dto: CreateCredentialDto,
  ) {
    return this.admin.createCredential(user.userId, providerId, dto);
  }

  @Patch('providers/:id/credentials/:credentialId')
  updateCredential(
    @CurrentUser() user: AuthUser,
    @Param('id') providerId: string,
    @Param('credentialId') credentialId: string,
    @Body()
    dto: { label?: string; enabled?: boolean; priority?: number; apiKey?: string },
  ) {
    return this.admin.updateCredential(user.userId, providerId, credentialId, dto);
  }

  @Delete('providers/:id/credentials/:credentialId')
  async deleteCredential(
    @CurrentUser() user: AuthUser,
    @Param('id') providerId: string,
    @Param('credentialId') credentialId: string,
  ) {
    const removed = await this.admin.deleteCredential(user.userId, providerId, credentialId);
    return { removed };
  }

  @Post('providers/:id/credentials/:credentialId/test')
  testCredential(
    @Param('id') providerId: string,
    @Param('credentialId') credentialId: string,
  ) {
    return this.admin.testCredential(providerId, credentialId);
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
