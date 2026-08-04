import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { clampInt } from '../common/num.util';
import { StorageService } from './storage.service';
import {
  CreateStorageProviderDto,
  UpdateStorageProviderDto,
} from './dto/storage-provider.dto';

@Controller('admin/storage')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Get('assets')
  listAssets(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.storage.list(
      clampInt(limit, 100, 1, 500),
      clampInt(offset, 0, 0, 100000),
    );
  }

  @Get('assets/:id/file')
  async file(@Param('id') id: string, @Res() res: Response) {
    const { buffer, mime } = await this.storage.readFile(id);
    res.setHeader('Content-Type', mime ?? 'application/octet-stream');
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  }

  @Delete('assets/:id')
  remove(@Param('id') id: string) {
    return this.storage.remove(id);
  }

  // ── Storage providers (backends / routes) ───────────────────────────────
  @Get('providers')
  async listProviders() {
    const rows = await this.storage.listProviders();
    return rows.map((p) => ({
      ...p,
      configEnc: undefined,
      configConfigured: Boolean(p.configEnc),
    }));
  }

  @Post('providers')
  async createProvider(@Body() dto: CreateStorageProviderDto) {
    const row = await this.storage.createProvider(dto);
    return {
      id: row.id,
      name: row.name,
      driver: row.driver,
      enabled: row.enabled,
      isActive: row.isActive,
      priority: row.priority,
      configConfigured: Boolean(row.configEnc),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  @Patch('providers/:id')
  async updateProvider(
    @Param('id') id: string,
    @Body() dto: UpdateStorageProviderDto,
  ) {
    const row = await this.storage.updateProvider(id, dto);
    return {
      id: row.id,
      name: row.name,
      driver: row.driver,
      enabled: row.enabled,
      isActive: row.isActive,
      priority: row.priority,
      configConfigured: Boolean(row.configEnc),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  @Delete('providers/:id')
  async deleteProvider(@Param('id') id: string) {
    const removed = await this.storage.deleteProvider(id);
    return { removed };
  }

  @Post('providers/:id/test')
  testProvider(@Param('id') id: string) {
    return this.storage.testProvider(id);
  }
}
