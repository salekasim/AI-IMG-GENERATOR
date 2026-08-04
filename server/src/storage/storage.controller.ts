import {
  Controller,
  Delete,
  Get,
  Param,
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
}
