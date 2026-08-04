import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ToolsService } from './tools.service';

@Controller('admin/tools')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ToolsController {
  constructor(private readonly tools: ToolsService) {}

  @Get()
  list() {
    return this.tools.list();
  }

  @Patch(':key')
  async update(@Param('key') key: string, @Body() body: any) {
    const updated = await this.tools.update(key, {
      name: body.name,
      description: body.description,
      icon: body.icon,
      color: body.color,
      enabled: body.enabled,
      paramSchema: body.paramSchema,
      defaultChain: body.defaultChain,
    });
    if (!updated) throw new NotFoundException(`Tool '${key}' not found`);
    return updated;
  }
}
