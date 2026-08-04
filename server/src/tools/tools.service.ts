import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, Tool } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TOOL_SEEDS } from './tool-registry';

@Injectable()
export class ToolsService implements OnModuleInit {
  private readonly logger = new Logger(ToolsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedDefaults();
  }

  private async seedDefaults() {
    for (const seed of TOOL_SEEDS) {
      await this.prisma.tool.upsert({
        where: { key: seed.key },
        update: {
          name: seed.name,
          category: seed.category,
          description: seed.description,
          icon: seed.icon,
          color: seed.color,
          capability: seed.capability,
          requiresInput: seed.requiresInput ?? false,
          // Never overwrite admin-tuned binding on restart
        },
        create: {
          key: seed.key,
          name: seed.name,
          category: seed.category,
          description: seed.description,
          icon: seed.icon,
          color: seed.color,
          capability: seed.capability,
          requiresInput: seed.requiresInput ?? false,
          enabled: true,
          paramSchema: seed.params as unknown as Prisma.InputJsonValue,
          defaultBinding: seed.defaultBinding,
        },
      });
    }
  }

  list() {
    return this.prisma.tool.findMany({ orderBy: { key: 'asc' } });
  }

  listEnabled() {
    return this.prisma.tool.findMany({
      where: { enabled: true },
      orderBy: { key: 'asc' },
    });
  }

  async findByKey(key: string): Promise<Tool | null> {
    return this.prisma.tool.findUnique({ where: { key } });
  }

  /**
   * Ordered provider/model binding for a tool: explicit node chain →
   * tool defaultBinding → empty (caller falls back to routing variable /
   * legacy single provider fields).
   */
  async resolveBinding(
    toolKey: string,
    nodeChain?: Array<{ provider?: string; model?: string }>,
  ): Promise<Array<{ provider: string; model: string }>> {
    if (Array.isArray(nodeChain) && nodeChain.length) {
      return nodeChain
        .filter(
          (s) =>
            typeof s?.provider === 'string' &&
            s.provider.trim() !== '' &&
            typeof s?.model === 'string' &&
            s.model.trim() !== '',
        )
        .map((s) => ({
          provider: String(s.provider).trim(),
          model: String(s.model).trim(),
        }));
    }
    const tool = await this.findByKey(toolKey);
    const binding = Array.isArray(tool?.defaultBinding)
      ? (tool.defaultBinding as Array<{ provider?: string; model?: string }>)
      : [];
    return binding
      .filter(
        (s) =>
          typeof s?.provider === 'string' &&
          s.provider.trim() !== '' &&
          typeof s?.model === 'string' &&
          s.model.trim() !== '',
      )
      .map((s) => ({
        provider: String(s.provider).trim(),
        model: String(s.model).trim(),
      }));
  }

  async update(
    key: string,
    data: {
      name?: string;
      description?: string;
      icon?: string;
      color?: string;
      enabled?: boolean;
      paramSchema?: unknown;
      defaultBinding?: unknown;
    },
  ) {
    const tool = await this.prisma.tool.findUnique({ where: { key } });
    if (!tool) return null;
    const update: Record<string, unknown> = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;
    if (data.icon !== undefined) update.icon = data.icon;
    if (data.color !== undefined) update.color = data.color;
    if (data.enabled !== undefined) update.enabled = data.enabled;
    if (data.paramSchema !== undefined) update.paramSchema = data.paramSchema;
    if (data.defaultBinding !== undefined) {
      update.defaultBinding = data.defaultBinding;
    }
    return this.prisma.tool.update({ where: { key }, data: update });
  }
}
