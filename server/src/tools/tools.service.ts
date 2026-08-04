import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, Capability } from '@prisma/client';
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
      const existing = await this.prisma.capability.findUnique({
        where: { key: seed.key },
      });
      const shouldRefreshBinding =
        !existing ||
        !existing.defaultChain ||
        !Array.isArray(existing.defaultChain) ||
        (existing.defaultChain as Array<{ provider?: string; model?: string }>)
          .length === 0 ||
        JSON.stringify(
          (existing.defaultChain as Array<{ provider?: string; model?: string }>)
            .map((step) => `${step.provider}/${step.model}`),
        ) === JSON.stringify(['pollinations/flux']);
      await this.prisma.capability.upsert({
        where: { key: seed.key },
        update: {
          name: seed.name,
          category: seed.category,
          description: seed.description,
          icon: seed.icon,
          color: seed.color,
          capability: seed.capability,
          requiresInput: seed.requiresInput ?? false,
          hasRuntime: seed.hasRuntime ?? true,
          // Ports/defaults are registry-owned metadata — refresh every boot.
          inputPorts: (seed.inputPorts ?? []) as unknown as Prisma.InputJsonValue,
          outputPorts: (seed.outputPorts ?? []) as unknown as Prisma.InputJsonValue,
          defaults: (seed.defaults ?? {}) as unknown as Prisma.InputJsonValue,
          // Refresh the binding only when it was never customized
          ...(shouldRefreshBinding ? { defaultChain: seed.defaultChain } : {}),
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
          hasRuntime: seed.hasRuntime ?? true,
          inputPorts: (seed.inputPorts ?? []) as unknown as Prisma.InputJsonValue,
          outputPorts: (seed.outputPorts ?? []) as unknown as Prisma.InputJsonValue,
          paramSchema: seed.params as unknown as Prisma.InputJsonValue,
          defaults: (seed.defaults ?? {}) as unknown as Prisma.InputJsonValue,
          defaultChain: seed.defaultChain,
        },
      });
    }
  }

  list() {
    return this.prisma.capability.findMany({ orderBy: { key: 'asc' } });
  }

  listEnabled() {
    return this.prisma.capability.findMany({
      where: { enabled: true },
      orderBy: { key: 'asc' },
    });
  }

  async findByKey(key: string): Promise<Capability | null> {
    return this.prisma.capability.findUnique({ where: { key } });
  }

  /**
   * Ordered provider/model binding for a Capability: explicit node chain →
   * Capability defaultChain → empty (caller falls back to routing variable /
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
    const Capability = await this.findByKey(toolKey);
    const binding = Array.isArray(Capability?.defaultChain)
      ? (Capability.defaultChain as Array<{ provider?: string; model?: string }>)
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
      defaultChain?: unknown;
    },
  ) {
    const Capability = await this.prisma.capability.findUnique({ where: { key } });
    if (!Capability) return null;
    const update: Record<string, unknown> = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;
    if (data.icon !== undefined) update.icon = data.icon;
    if (data.color !== undefined) update.color = data.color;
    if (data.enabled !== undefined) update.enabled = data.enabled;
    if (data.paramSchema !== undefined) update.paramSchema = data.paramSchema;
    if (data.defaultChain !== undefined) {
      update.defaultChain = data.defaultChain;
    }
    return this.prisma.capability.update({ where: { key }, data: update });
  }
}
