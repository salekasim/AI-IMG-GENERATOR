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
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import {
  DuplicateWorkflowDto,
  UpdateWorkflowDto,
} from './dto/update-workflow.dto';
import { WorkflowService } from './workflow.service';

@Controller('orchestrator/workflows')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class WorkflowController {
  constructor(private readonly workflows: WorkflowService) {}

  @Get()
  list() {
    return this.workflows.list();
  }

  @Post()
  create(@Body() dto: CreateWorkflowDto) {
    return this.workflows.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workflows.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWorkflowDto) {
    return this.workflows.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.workflows.remove(id);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string, @Body() dto: DuplicateWorkflowDto) {
    return this.workflows.duplicate(id, dto.name);
  }
}
