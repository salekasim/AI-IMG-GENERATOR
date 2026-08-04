import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Project } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Node type → public capability shown on the client website. */
const MODEL_NODE_CAPABILITIES: Record<string, string> = {
  imageModel: 'image',
  imageGeneration: 'image',
  iconModel: 'image',
  iconGeneration: 'image',
  logoModel: 'image',
  logoGeneration: 'image',
  object3dModel: 'image',
  object3dGeneration: 'image',
  videoModel: 'video',
  videoGeneration: 'video',
  chatModel: 'text',
  textGeneration: 'text',
};

export interface ClientModel {
  id: string; // workflow id
  name: string; // public model name (clientModelName ?? workflow name)
  provider: string;
  model: string;
  capability: 'image' | 'video' | 'text';
}

@Injectable()
export class ClientService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async resolveProject(secretKey: string): Promise<Project> {
    const project = await this.prisma.project.findUnique({
      where: { secretKey },
    });
    if (!project) throw new UnauthorizedException('Invalid project key');
    if (!project.enabled)
      throw new UnauthorizedException('Project is disabled');
    return project;
  }

  async modelsFor(secretKey: string): Promise<{ models: ClientModel[] }> {
    const project = await this.resolveProject(secretKey);
    return { models: await this.clientModelsFor(project.id) };
  }

  /**
   * Published client models for a project: every workflow with
   * clientEnabled=true exposes exactly ONE model (its first model-capable
   * node's primary chain step). Only VALID models are returned —
   * provider enabled + healthStatus != down + model enabled.
   */
  async clientModelsFor(projectId: string): Promise<ClientModel[]> {
    const [workflows, providers, models] = await Promise.all([
      this.prisma.workflow.findMany({
        where: { projectId, enabled: true, clientEnabled: true },
        orderBy: [{ name: 'asc' }],
        select: { id: true, name: true, clientModelName: true, graph: true },
      }),
      this.prisma.aiProvider.findMany({
        select: { id: true, name: true, enabled: true, healthStatus: true },
      }),
      this.prisma.aiModel.findMany({
        select: { providerId: true, internalName: true, enabled: true },
      }),
    ]);

    const providerByName = new Map(providers.map((p) => [p.name, p]));
    const modelByKey = new Map(
      models.map((m) => [`${m.providerId}:${m.internalName}`, m]),
    );

    const result: ClientModel[] = [];
    for (const workflow of workflows) {
      const primary = this.primaryModelStep(
        workflow.graph as Record<string, unknown> | null,
      );
      if (!primary) continue;

      const provider = providerByName.get(primary.provider);
      if (!provider || !provider.enabled || provider.healthStatus === 'down') {
        continue;
      }
      const modelRow = modelByKey.get(`${provider.id}:${primary.model}`);
      if (modelRow && !modelRow.enabled) continue;

      result.push({
        id: workflow.id,
        name: workflow.clientModelName?.trim() || workflow.name,
        provider: primary.provider,
        model: primary.model,
        capability: primary.capability,
      });
    }
    return result;
  }

  /** First model-capable node in the graph → { provider, model, capability }. */
  private primaryModelStep(graph: Record<string, unknown> | null): {
    provider: string;
    model: string;
    capability: 'image' | 'video' | 'text';
  } | null {
    const nodes: Array<Record<string, unknown>> = Array.isArray(
      (graph as { nodes?: unknown } | null)?.nodes,
    )
      ? ((graph as { nodes: unknown[] }).nodes as Array<
          Record<string, unknown>
        >)
      : [];
    for (const node of nodes) {
      const data = (node?.data as Record<string, unknown> | undefined) ?? {};
      const type = String(
        node?.type ?? data.type ?? '',
      );
      const capability = MODEL_NODE_CAPABILITIES[type];
      if (!capability) continue;
      const config =
        (node?.config as Record<string, unknown> | undefined) ??
        (data.config as Record<string, unknown> | undefined) ??
        {};
      const step = this.firstChainStep(config);
      if (step) return { ...step, capability: capability as 'image' | 'video' | 'text' };
    }
    return null;
  }

  /** Explicit chain → routing variable → legacy single provider/model. */
  private firstChainStep(config: Record<string, unknown>): {
    provider: string;
    model: string;
  } | null {
    const chain = Array.isArray(config.chain)
      ? (config.chain as Array<Record<string, unknown>>)
      : [];
    for (const s of chain) {
      if (
        typeof s?.provider === 'string' &&
        s.provider.trim() !== '' &&
        typeof s?.model === 'string' &&
        s.model.trim() !== ''
      ) {
        return { provider: s.provider.trim(), model: s.model.trim() };
      }
    }
    if (
      typeof config.provider === 'string' &&
      config.provider.trim() !== ''
    ) {
      return {
        provider: config.provider.trim(),
        model:
          typeof config.model === 'string' && config.model.trim() !== ''
            ? config.model.trim()
            : '',
      };
    }
    return null;
  }

  signStreamToken(projectId: string): string {
    return this.jwt.sign({ scope: 'client', projectId }, { expiresIn: '2h' });
  }

  verifyStreamToken(token: string, projectId: string): boolean {
    try {
      const payload = this.jwt.verify(token);
      return payload.scope === 'client' && payload.projectId === projectId;
    } catch {
      return false;
    }
  }
}
