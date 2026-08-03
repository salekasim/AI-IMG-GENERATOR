import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CreateProjectDto, LinkWorkflowsDto, UpdateProjectDto } from './dto/project.dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.projects.list(user.userId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto) {
    return this.projects.create(user.userId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(id, user.userId, dto);
  }

  @Post(':id/regenerate-key')
  regenerateKey(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.projects.regenerateKey(id, user.userId);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.projects.remove(id, user.userId);
  }

  @Get(':id/workflows')
  listWorkflows(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.projects.listWorkflows(id, user.userId);
  }

  @Post(':id/workflows')
  linkWorkflows(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: LinkWorkflowsDto,
  ) {
    return this.projects.linkWorkflows(id, user.userId, dto);
  }

  @Delete(':id/workflows/:workflowId')
  unlinkWorkflow(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('workflowId') workflowId: string,
  ) {
    return this.projects.unlinkWorkflow(id, workflowId, user.userId);
  }
}
