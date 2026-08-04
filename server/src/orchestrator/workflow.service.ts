import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { WORKFLOW_TEMPLATES } from './workflow-templates';

const GRAPH_LIMIT = 250;

@Injectable()
export class WorkflowService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedTemplates();
  }

  private async seedTemplates() {
    for (const template of WORKFLOW_TEMPLATES) {
      const existing = await this.prisma.workflow.findFirst({
        where: { name: template.name },
        select: { id: true },
      });
      if (existing) continue;
      await this.prisma.workflow.create({
        data: {
          name: template.name,
          description: template.description,
          graph: template.graph as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }

  async list() {
    const workflows = await this.prisma.workflow.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        enabled: true,
        version: true,
        webhookUrl: true,
        projectId: true,
        clientEnabled: true,
        clientModelName: true,
        createdAt: true,
        updatedAt: true,
        graph: true,
      },
    });
    return workflows.map(({ graph, ...workflow }) => ({
      ...workflow,
      nodeCount: (graph as { nodes?: unknown[] } | null)?.nodes?.length ?? 0,
    }));
  }

  async findOne(id: string) {
    const workflow = await this.prisma.workflow.findUnique({ where: { id } });
    if (!workflow) {
      throw new NotFoundException('Workflow not found');
    }
    return workflow;
  }

  async create(dto: CreateWorkflowDto) {
    this.validateGraph(dto.graph);
    return this.prisma.workflow.create({
      data: {
        name: dto.name,
        description: dto.description,
        webhookUrl: dto.webhookUrl ?? null,
        graph: dto.graph as Prisma.InputJsonValue,
      },
    });
  }

  async update(id: string, dto: UpdateWorkflowDto) {
    const existing = await this.findOne(id);
    if (!existing) {
      throw new NotFoundException('Workflow not found');
    }
    const data: Prisma.WorkflowUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.webhookUrl !== undefined) data.webhookUrl = dto.webhookUrl;
    if (dto.webhookUrlClear === true) data.webhookUrl = null;
    if (dto.clientEnabled !== undefined) data.clientEnabled = dto.clientEnabled;
    if (dto.clientModelName !== undefined) {
      data.clientModelName = dto.clientModelName.trim() ? dto.clientModelName.trim() : null;
    }
    if (dto.graph !== undefined) {
      this.validateGraph(dto.graph);
      data.graph = dto.graph as Prisma.InputJsonValue;
      data.version = existing.version + 1;
    }
    return this.prisma.workflow.update({ where: { id }, data });
  }

  async remove(id: string) {
    const existing = await this.findOne(id);
    if (!existing) {
      throw new NotFoundException('Workflow not found');
    }
    await this.prisma.workflow.delete({ where: { id } });
    return { id };
  }

  async duplicate(id: string, name: string) {
    const existing = await this.findOne(id);
    if (!existing) {
      throw new NotFoundException('Workflow not found');
    }
    return this.prisma.workflow.create({
      data: {
        name,
        description: existing.description,
        graph: existing.graph as unknown as Prisma.InputJsonValue,
        enabled: false,
      },
    });
  }

  private validateGraph(graph: Record<string, unknown>) {
    const nodes = (graph as { nodes?: unknown }).nodes;
    const edges = (graph as { edges?: unknown }).edges;
    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      throw new BadRequestException(
        'graph must contain nodes and edges arrays',
      );
    }
    if (nodes.length > GRAPH_LIMIT) {
      throw new BadRequestException(
        `graph exceeds node limit of ${GRAPH_LIMIT}`,
      );
    }
    const ids = new Set<string>();
    for (const node of nodes as Array<{ id?: unknown }>) {
      if (typeof node?.id !== 'string' || !node.id) {
        throw new BadRequestException('each node must have a string id');
      }
      if (ids.has(node.id)) {
        throw new BadRequestException(`duplicate node id: ${node.id}`);
      }
      ids.add(node.id);
    }
    for (const edge of edges as Array<{ source?: unknown; target?: unknown }>) {
      if (
        typeof edge?.source !== 'string' ||
        typeof edge?.target !== 'string' ||
        !ids.has(edge.source) ||
        !ids.has(edge.target)
      ) {
        throw new BadRequestException('edges must reference existing node ids');
      }
    }
  }
}
