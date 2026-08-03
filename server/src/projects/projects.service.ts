import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateProjectDto,
  LinkWorkflowsDto,
  UpdateProjectDto,
} from './dto/project.dto';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ownerId: string) {
    const projects = await this.prisma.project.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
      include: {
        workflows: { select: { id: true, name: true, enabled: true } },
        _count: { select: { executions: true } },
      },
    });
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      secretKeyLast4: p.secretKey.slice(-4),
      enabled: p.enabled,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      workflows: p.workflows,
      workflowCount: p.workflows.length,
      executionCount: p._count.executions,
    }));
  }

  async create(ownerId: string, dto: CreateProjectDto) {
    const project = await this.prisma.project.create({
      data: {
        name: dto.name,
        description: dto.description,
        ownerId,
        secretKey: this.generateKey(),
      },
    });
    if (dto.workflowIds?.length) {
      await this.linkWorkflows(project.id, ownerId, {
        workflowIds: dto.workflowIds,
      });
    }
    return project;
  }

  async linkWorkflows(
    projectId: string,
    ownerId: string,
    dto: LinkWorkflowsDto,
  ) {
    await this.ensureOwner(projectId, ownerId);
    const ids = new Set(dto.workflowIds);
    const workflows = await this.prisma.workflow.findMany({
      where: { id: { in: [...ids] } },
    });
    if (workflows.length !== ids.size) {
      throw new NotFoundException('One or more workflows not found');
    }
    await this.prisma.$transaction(
      workflows.map((w) =>
        this.prisma.workflow.update({
          where: { id: w.id },
          data: { projectId },
        }),
      ),
    );
    return { linked: workflows.length };
  }

  async unlinkWorkflow(projectId: string, workflowId: string, ownerId: string) {
    await this.ensureOwner(projectId, ownerId);
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
    });
    if (!workflow) throw new NotFoundException('Workflow not found');
    if (workflow.projectId !== projectId)
      throw new NotFoundException('Workflow is not linked to this project');
    return this.prisma.workflow.update({
      where: { id: workflowId },
      data: { projectId: null },
    });
  }

  async update(id: string, ownerId: string, dto: UpdateProjectDto) {
    const project = await this.ensureOwner(id, ownerId);
    return this.prisma.project.update({
      where: { id: project.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      },
    });
  }

  async regenerateKey(id: string, ownerId: string) {
    const project = await this.ensureOwner(id, ownerId);
    const secretKey = this.generateKey();
    await this.prisma.project.update({
      where: { id: project.id },
      data: { secretKey },
    });
    return { id: project.id, secretKey };
  }

  async remove(id: string, ownerId: string) {
    const project = await this.ensureOwner(id, ownerId);
    await this.prisma.project.delete({ where: { id: project.id } });
    return { id: project.id };
  }

  async listWorkflows(projectId: string, ownerId: string) {
    const project = await this.ensureOwner(projectId, ownerId);
    return this.prisma.workflow.findMany({
      where: { projectId: project.id },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        enabled: true,
        webhookUrl: true,
        updatedAt: true,
        _count: { select: { executions: true } },
      },
    });
  }

  private async ensureOwner(id: string, ownerId: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.ownerId !== ownerId)
      throw new NotFoundException('Project not found');
    return project;
  }

  private generateKey(): string {
    return `pk_${randomBytes(24).toString('base64url')}`;
  }
}
