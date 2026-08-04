import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AiProvider, Prisma, Role } from '@prisma/client';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';
import { SettingsService } from './settings.service';
import {
  CreateProviderDto,
  CreateProviderModelDto,
  UpdateProviderModelDto,
} from './dto/create-provider.dto';
import { CreateCredentialDto, CreateRouteDto, UpdateRouteDto } from './dto/route.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const SUCCESS = 'success';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private get startOfDay(): Date {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start;
  }

  private dayKey(date: Date): string {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  async stats() {
    const startOfDay = this.startOfDay;
    const weekStart = new Date(startOfDay);
    weekStart.setDate(weekStart.getDate() - 6);

    const [
      totalUsers,
      admins,
      banned,
      totalGenerations,
      todayGenerations,
      activeToday,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: Role.ADMIN } }),
      this.prisma.user.count({ where: { banned: true } }),
      this.prisma.usageRecord.count({ where: { status: SUCCESS } }),
      this.prisma.usageRecord.count({
        where: { status: SUCCESS, createdAt: { gte: startOfDay } },
      }),
      this.prisma.user.count({ where: { lastLoginAt: { gte: startOfDay } } }),
    ]);

    const [recentRecords, providers, providerUsage] = await Promise.all([
      this.prisma.usageRecord.findMany({
        where: { status: SUCCESS, createdAt: { gte: weekStart } },
        select: { createdAt: true },
      }),
      this.prisma.aiProvider.findMany({
        select: { id: true, name: true, displayName: true },
      }),
      this.prisma.usageRecord.groupBy({
        by: ['providerId'],
        _count: { _all: true },
        where: { status: SUCCESS },
      }),
    ]);

    const dayCounts = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(startOfDay);
      d.setDate(d.getDate() - i);
      dayCounts.set(this.dayKey(d), 0);
    }
    for (const record of recentRecords) {
      const key = this.dayKey(record.createdAt);
      dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
    }
    const last7Days = [...dayCounts.entries()].map(([date, count]) => ({
      date,
      count,
    }));

    const nameById = new Map(providers.map((p) => [p.id, p]));
    const perProvider = providerUsage.map((u) => ({
      provider: nameById.get(u.providerId)?.name ?? u.providerId,
      displayName: nameById.get(u.providerId)?.displayName ?? u.providerId,
      count: u._count._all,
    }));

    return {
      totalUsers,
      admins,
      banned,
      totalGenerations,
      todayGenerations,
      activeToday,
      last7Days,
      perProvider,
    };
  }

  async listUsers(q?: string, limit = 50) {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const where: Prisma.UserWhereInput = q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};
    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        role: true,
        provider: true,
        dailyQuota: true,
        banned: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
    const usage = await this.prisma.usageRecord.groupBy({
      by: ['userId'],
      _count: { _all: true },
      where: { status: SUCCESS, createdAt: { gte: this.startOfDay } },
    });
    const usedToday = new Map(usage.map((u) => [u.userId, u._count._all]));
    return users.map((u) => ({ ...u, usedToday: usedToday.get(u.id) ?? 0 }));
  }

  async updateUser(actorId: string, id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (
      id === actorId &&
      (dto.role !== undefined || dto.banned !== undefined)
    ) {
      throw new ForbiddenException(
        'You cannot change your own role or ban status',
      );
    }
    const data: Prisma.UserUpdateInput = {};
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.dailyQuota !== undefined) data.dailyQuota = dto.dailyQuota;
    if (dto.banned !== undefined) data.banned = dto.banned;

    const updated = await this.prisma.user.update({ where: { id }, data });
    await this.audit.log(actorId, 'users.update', {
      id: updated.id,
      email: updated.email,
      role: dto.role,
      dailyQuota: dto.dailyQuota,
      banned: dto.banned,
    });
    return {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      dailyQuota: updated.dailyQuota,
      banned: updated.banned,
    };
  }

  async listProviders() {
    const providers = await this.prisma.aiProvider.findMany({
      orderBy: { priority: 'asc' },
      include: {
        models: {
          where: { hidden: false },
          orderBy: { priority: 'asc' },
          select: {
            id: true,
            displayName: true,
            internalName: true,
            enabled: true,
            hidden: true,
            supportsImages: true,
            supportsVision: true,
            supportsVideo: true,
            maxTokens: true,
            costPer1kIn: true,
            costPer1kOut: true,
          },
        },
        credentials: {
          orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            label: true,
            enabled: true,
            priority: true,
            failureStreak: true,
            lastUsedAt: true,
            lastError: true,
            apiKeyEnc: true,
          },
        },
      },
    });
    return providers.map((p) => ({
      id: p.id,
      name: p.name,
      displayName: p.displayName,
      baseUrl: p.baseUrl,
      enabled: p.enabled,
      priority: p.priority,
      timeoutMs: p.timeoutMs,
      supportsImages: p.supportsImages,
      supportsVision: p.supportsVision,
      supportsVideo: p.supportsVideo,
      healthStatus: p.healthStatus,
      failureStreak: p.failureStreak,
      apiKeyConfigured: !!p.apiKeyEnc,
      apiKeyMasked: p.apiKeyEnc ? this.maskKey(p.apiKeyEnc) : null,
      models: p.models,
      credentials: p.credentials.map((c) => ({
        id: c.id,
        label: c.label,
        enabled: c.enabled,
        priority: c.priority,
        failureStreak: c.failureStreak,
        lastUsedAt: c.lastUsedAt,
        lastError: c.lastError,
        apiKeyConfigured: Boolean(c.apiKeyEnc),
        apiKeyMasked: this.maskKey(c.apiKeyEnc),
      })),
      updatedAt: p.updatedAt,
    }));
  }

  async createProvider(actorId: string, dto: CreateProviderDto) {
    const name = dto.name.trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,40}$/.test(name)) {
      throw new BadRequestException(
        'name must be 2-40 chars using a-z, 0-9, _ or -',
      );
    }
    const existing = await this.prisma.aiProvider.findUnique({
      where: { name },
    });
    if (existing) {
      throw new BadRequestException(`Provider '${name}' already exists`);
    }
    const baseUrl = dto.baseUrl?.trim() || 'https://api.example.com/v1';
    if (!/^https?:\/\//.test(baseUrl)) {
      throw new BadRequestException('baseUrl must start with http(s)://');
    }
    const created = await this.prisma.aiProvider.create({
      data: {
        name,
        displayName: dto.displayName.trim(),
        baseUrl,
        enabled: dto.enabled ?? true,
        supportsImages: dto.supportsImages ?? false,
        supportsVision: dto.supportsVision ?? false,
        supportsVideo: dto.supportsVideo ?? false,
        priority: dto.priority ?? 100,
        timeoutMs: dto.timeoutMs ?? 30_000,
        apiKeyEnc: dto.apiKey?.trim()
          ? this.crypto.encrypt(dto.apiKey.trim())
          : null,
        models: dto.models?.length
          ? {
              create: dto.models.map((m) => ({
                displayName: m.displayName,
                internalName: m.internalName,
                enabled: m.enabled ?? true,
                supportsImages: m.supportsImages ?? false,
                supportsVision: m.supportsVision ?? false,
                supportsVideo: m.supportsVideo ?? false,
                maxTokens: m.maxTokens ?? null,
                hidden: m.hidden ?? false,
              })),
            }
          : undefined,
      },
      include: { models: true },
    });
    await this.audit.log(actorId, 'providers.create', {
      id: created.id,
      name: created.name,
    });
    return {
      id: created.id,
      name: created.name,
      displayName: created.displayName,
      enabled: created.enabled,
      apiKeyConfigured: !!created.apiKeyEnc,
      models: created.models.length,
    };
  }

  async createModel(
    actorId: string,
    providerId: string,
    dto: CreateProviderModelDto,
  ) {
    const provider = await this.prisma.aiProvider.findUnique({
      where: { id: providerId },
    });
    if (!provider) {
      throw new NotFoundException('Provider not found');
    }
    const created = await this.prisma.aiModel.create({
      data: {
        providerId,
        displayName: dto.displayName.trim(),
        internalName: dto.internalName.trim(),
        enabled: dto.enabled ?? true,
        supportsImages: dto.supportsImages ?? false,
        supportsVision: dto.supportsVision ?? false,
        supportsVideo: dto.supportsVideo ?? false,
        maxTokens: dto.maxTokens ?? null,
        hidden: dto.hidden ?? false,
      },
    });
    await this.audit.log(actorId, 'providers.model.create', {
      providerId,
      id: created.id,
      internalName: created.internalName,
    });
    return created;
  }

  async updateModel(
    actorId: string,
    providerId: string,
    modelId: string,
    dto: UpdateProviderModelDto,
  ) {
    const model = await this.prisma.aiModel.findFirst({
      where: { id: modelId, providerId },
    });
    if (!model) {
      throw new NotFoundException('Model not found on this provider');
    }
    const data: Prisma.AiModelUpdateInput = {};
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.internalName !== undefined) data.internalName = dto.internalName;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.supportsImages !== undefined)
      data.supportsImages = dto.supportsImages;
    if (dto.supportsVision !== undefined)
      data.supportsVision = dto.supportsVision;
    if (dto.supportsVideo !== undefined) data.supportsVideo = dto.supportsVideo;
    if (dto.maxTokens !== undefined) data.maxTokens = dto.maxTokens;
    if (dto.hidden !== undefined) data.hidden = dto.hidden;
    const updated = await this.prisma.aiModel.update({
      where: { id: modelId },
      data,
    });
    await this.audit.log(actorId, 'providers.model.update', {
      providerId,
      id: updated.id,
      internalName: updated.internalName,
    });
    return updated;
  }

  async deleteModel(actorId: string, providerId: string, modelId: string) {
    const model = await this.prisma.aiModel.findFirst({
      where: { id: modelId, providerId },
    });
    if (!model) {
      throw new NotFoundException('Model not found on this provider');
    }
    await this.prisma.aiModel.delete({ where: { id: modelId } });
    await this.audit.log(actorId, 'providers.model.delete', {
      providerId,
      id: modelId,
      internalName: model.internalName,
    });
    return { deleted: true };
  }

  async listRoutingVariables() {
    return this.prisma.routingVariable.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' },
      include: {
        routes: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            order: true,
            model: {
              select: {
                id: true,
                internalName: true,
                displayName: true,
                supportsImages: true,
                enabled: true,
                provider: {
                  select: {
                    id: true,
                    name: true,
                    displayName: true,
                    enabled: true,
                    supportsImages: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  async updateProvider(actorId: string, id: string, dto: UpdateProviderDto) {
    const existing = await this.prisma.aiProvider.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Provider not found');
    }
    const data: Prisma.AiProviderUpdateInput = {};
    const changed: string[] = [];
    if (dto.displayName !== undefined) {
      data.displayName = dto.displayName;
      changed.push('displayName');
    }
    if (dto.baseUrl !== undefined) {
      if (!/^https?:\/\//.test(dto.baseUrl)) {
        throw new BadRequestException('baseUrl must start with http(s)://');
      }
      data.baseUrl = dto.baseUrl;
      changed.push('baseUrl');
    }
    if (dto.enabled !== undefined) {
      data.enabled = dto.enabled;
      changed.push('enabled');
    }
    if (dto.priority !== undefined) {
      data.priority = dto.priority;
      changed.push('priority');
    }
    if (dto.timeoutMs !== undefined) {
      data.timeoutMs = dto.timeoutMs;
      changed.push('timeoutMs');
    }
    if (dto.apiKey !== undefined) {
      data.apiKeyEnc =
        dto.apiKey.trim() === ''
          ? null
          : this.crypto.encrypt(dto.apiKey.trim());
      changed.push('apiKey');
    }
    if (dto.supportsImages !== undefined) {
      data.supportsImages = dto.supportsImages;
      changed.push('supportsImages');
    }
    if (dto.supportsVision !== undefined) {
      data.supportsVision = dto.supportsVision;
      changed.push('supportsVision');
    }
    if (dto.supportsVideo !== undefined) {
      data.supportsVideo = dto.supportsVideo;
      changed.push('supportsVideo');
    }

    const updated = await this.prisma.aiProvider.update({
      where: { id },
      data,
    });
    await this.audit.log(actorId, 'providers.update', {
      id: updated.id,
      name: updated.name,
      changed,
    });
    return {
      id: updated.id,
      name: updated.name,
      enabled: updated.enabled,
      priority: updated.priority,
      changed,
    };
  }

  async testProvider(id: string) {
    const provider = await this.prisma.aiProvider.findUnique({ where: { id } });
    if (!provider) {
      throw new NotFoundException('Provider not found');
    }
    const startedAt = Date.now();
    try {
      const apiKey = provider.apiKeyEnc
        ? this.crypto.decrypt(provider.apiKeyEnc)
        : null;
      const headers: Record<string, string> = apiKey
        ? { Authorization: `${provider.name.startsWith('fal-') ? 'Key' : 'Bearer'} ${apiKey}` }
        : {};
      const response = await fetch(this.testUrl(provider), {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      const latencyMs = Date.now() - startedAt;
      const ok = response.ok;
      return {
        ok,
        latencyMs,
        status: response.status,
        message: ok
          ? `Connected (HTTP ${response.status})`
          : `HTTP ${response.status} ${(await response.text().catch(() => '')).slice(0, 200)}`.trim(),
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        status: 0,
        message: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  private testUrl(provider: AiProvider): string {
    const base = provider.baseUrl.replace(/\/+$/, '');
    switch (provider.name) {
      case 'openai':
        return `${base}/models`;
      case 'stability':
        return `${base}/v2beta/user`;
      case 'fal-image':
      case 'fal-video':
        // queue root responds to an unauthenticated GET; the queue host serves
        // the status/result endpoints under it.
        return `${base}/requests/health`;
      default:
        return base;
    }
  }

  // ── Model routes (fallback groups) ─────────────────────────────────────

  listRoutes() {
    return this.prisma.modelRoute.findMany({
      orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async createRoute(actorId: string, dto: CreateRouteDto) {
    const route = await this.prisma.modelRoute.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        steps: (dto.steps ?? []) as unknown as Prisma.InputJsonValue,
        retryPolicy: (dto.retryPolicy ?? {}) as unknown as Prisma.InputJsonValue,
        enabled: true,
        createdBy: actorId,
      },
    });
    await this.audit.log(actorId, 'route.create', { id: route.id, name: route.name });
    return route;
  }

  async updateRoute(actorId: string, id: string, dto: UpdateRouteDto) {
    const existing = await this.prisma.modelRoute.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Model route not found');
    const route = await this.prisma.modelRoute.update({
      where: { id },
      data: {
        name: dto.name ?? existing.name,
        description: dto.description !== undefined ? dto.description : existing.description,
        steps: dto.steps !== undefined
          ? (dto.steps as unknown as Prisma.InputJsonValue)
          : (existing.steps as unknown as Prisma.InputJsonValue),
        retryPolicy:
          dto.retryPolicy !== undefined
            ? (dto.retryPolicy as unknown as Prisma.InputJsonValue)
            : (existing.retryPolicy as unknown as Prisma.InputJsonValue),
        enabled: dto.enabled ?? existing.enabled,
      },
    });
    await this.audit.log(actorId, 'route.update', { id: route.id, name: route.name });
    return route;
  }

  async deleteRoute(actorId: string, id: string) {
    const existing = await this.prisma.modelRoute.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Model route not found');
    await this.prisma.modelRoute.delete({ where: { id } });
    await this.audit.log(actorId, 'route.delete', { id, name: existing.name });
    return true;
  }

  // ── Provider credentials (key pool / rotation) ──────────────────────────

  private async requireProvider(providerId: string) {
    const provider = await this.prisma.aiProvider.findUnique({
      where: { id: providerId },
    });
    if (!provider) throw new NotFoundException('Provider not found');
    return provider;
  }

  private maskKey(encrypted: string): string {
    try {
      const plain = this.crypto.decrypt(encrypted);
      if (!plain) return null as unknown as string;
      const len = plain.length;
      return len <= 8 ? '••••' : `${plain.slice(0, 4)}••••${plain.slice(-4)}`;
    } catch {
      return '••••';
    }
  }

  async createCredential(actorId: string, providerId: string, dto: CreateCredentialDto) {
    await this.requireProvider(providerId);
    if (!dto.apiKey.trim()) {
      throw new BadRequestException('API key is required');
    }
    const created = await this.prisma.providerCredential.create({
      data: {
        providerId,
        label: dto.label.trim() || 'Default',
        apiKeyEnc: this.crypto.encrypt(dto.apiKey),
        enabled: dto.enabled ?? true,
        priority: dto.priority ?? 0,
      },
    });
    await this.audit.log(actorId, 'credential.create', {
      providerId,
      id: created.id,
      label: created.label,
    });
    return {
      id: created.id,
      label: created.label,
      enabled: created.enabled,
      priority: created.priority,
      apiKeyConfigured: true,
      apiKeyMasked: this.maskKey(created.apiKeyEnc),
    };
  }

  async updateCredential(
    actorId: string,
    providerId: string,
    credentialId: string,
    dto: {
      label?: string;
      enabled?: boolean;
      priority?: number;
      apiKey?: string;
    },
  ) {
    const existing = await this.prisma.providerCredential.findFirst({
      where: { id: credentialId, providerId },
    });
    if (!existing) throw new NotFoundException('Credential not found');
    const updated = await this.prisma.providerCredential.update({
      where: { id: credentialId },
      data: {
        label: dto.label !== undefined ? dto.label.trim() || 'Default' : existing.label,
        enabled: dto.enabled ?? existing.enabled,
        priority: dto.priority ?? existing.priority,
        apiKeyEnc:
          dto.apiKey && dto.apiKey.trim()
            ? this.crypto.encrypt(dto.apiKey)
            : existing.apiKeyEnc,
        // Rotation resets the failure bookkeeping
        failureStreak: dto.apiKey && dto.apiKey.trim() ? 0 : existing.failureStreak,
        lastError: dto.apiKey && dto.apiKey.trim() ? null : existing.lastError,
      },
    });
    await this.audit.log(actorId, 'credential.update', {
      providerId,
      id: credentialId,
      label: updated.label,
    });
    return {
      id: updated.id,
      label: updated.label,
      enabled: updated.enabled,
      priority: updated.priority,
      apiKeyConfigured: true,
      apiKeyMasked: this.maskKey(updated.apiKeyEnc),
    };
  }

  async deleteCredential(actorId: string, providerId: string, credentialId: string) {
    const existing = await this.prisma.providerCredential.findFirst({
      where: { id: credentialId, providerId },
    });
    if (!existing) throw new NotFoundException('Credential not found');
    await this.prisma.providerCredential.delete({ where: { id: credentialId } });
    await this.audit.log(actorId, 'credential.delete', {
      providerId,
      id: credentialId,
      label: existing.label,
    });
    return true;
  }

  async testCredential(providerId: string, credentialId: string) {
    const provider = await this.requireProvider(providerId);
    const credential = await this.prisma.providerCredential.findFirst({
      where: { id: credentialId, providerId },
    });
    if (!credential) throw new NotFoundException('Credential not found');
    const startedAt = Date.now();
    try {
      const apiKey = this.crypto.decrypt(credential.apiKeyEnc);
      const headers: Record<string, string> = {
        Authorization: `${provider.name.startsWith('fal-') ? 'Key' : 'Bearer'} ${apiKey}`,
      };
      const response = await fetch(this.testUrl(provider), {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      const latencyMs = Date.now() - startedAt;
      return {
        ok: response.ok,
        latencyMs,
        status: response.status,
        message: response.ok
          ? `Connected (HTTP ${response.status})`
          : `HTTP ${response.status} ${(await response.text().catch(() => '')).slice(0, 200)}`.trim(),
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        status: 0,
        message: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  async listSettings() {
    return this.settings.getAll();
  }

  async setSetting(actorId: string, key: string, value: unknown) {
    const result = await this.settings.set(key, value);
    await this.audit.log(actorId, 'settings.update', result);
    return result;
  }

  listAudit(limit = 100) {
    return this.audit.list(limit);
  }

  async clearAudit(actorId: string) {
    const removed = await this.audit.clear();
    if (removed > 0) {
      await this.audit.log(actorId, 'audit.clear', { removed });
    }
    return removed;
  }

  async analytics(days = 30) {
    const daysSafe = Math.min(
      Math.max(Number.isFinite(days) ? days : 30, 1),
      365,
    );
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - (daysSafe - 1));

    const [executions, providers, projects, users, usage] = await Promise.all([
      this.prisma.workflowExecution.findMany({
        where: { startedAt: { gte: from } },
        select: {
          id: true,
          status: true,
          source: true,
          createdBy: true,
          providerUsed: true,
          modelUsed: true,
          costUsd: true,
          durationMs: true,
          images: true,
          tokensIn: true,
          tokensOut: true,
          attempts: true,
          startedAt: true,
          projectId: true,
          workflow: { select: { id: true, name: true } },
        },
      }),
      this.prisma.aiProvider.findMany({
        select: {
          id: true,
          name: true,
          displayName: true,
          healthStatus: true,
          failureStreak: true,
        },
      }),
      this.prisma.project.findMany({
        select: { id: true, name: true, enabled: true },
      }),
      this.prisma.user.findMany({
        where: { usage: { some: { createdAt: { gte: from } } } },
        select: { id: true, email: true, name: true },
      }),
      this.prisma.usageRecord.findMany({
        where: { createdAt: { gte: from } },
        select: {
          providerId: true,
          status: true,
          costUsd: true,
          imageCount: true,
          createdAt: true,
        },
      }),
    ]);

    const providersById = new Map(providers.map((p) => [p.id, p]));
    const projectsById = new Map(projects.map((p) => [p.id, p]));
    const usersById = new Map(users.map((u) => [u.id, u]));

    const dayRuns = new Map<
      string,
      { runs: number; errors: number; costUsd: number }
    >();
    const providerAgg = new Map<
      string,
      {
        runs: number;
        ok: number;
        fail: number;
        latencyMs: number;
        costUsd: number;
      }
    >();
    const modelAgg = new Map<
      string,
      {
        runs: number;
        ok: number;
        fail: number;
        latencyMs: number;
        costUsd: number;
      }
    >();
    const workflowAgg = new Map<
      string,
      {
        name: string;
        runs: number;
        ok: number;
        latencyMs: number;
        costUsd: number;
      }
    >();
    const projectAgg = new Map<
      string,
      {
        name: string;
        runs: number;
        client: number;
        ok: number;
        costUsd: number;
      }
    >();
    const userAgg = new Map<
      string,
      { email: string; runs: number; ok: number; costUsd: number }
    >();
    const usageAgg = new Map<
      string,
      {
        name: string;
        calls: number;
        ok: number;
        images: number;
        costUsd: number;
      }
    >();

    let totalRuns = 0;
    let totalOk = 0;
    let totalCost = 0;
    let totalLatency = 0;
    let totalImages = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;

    const bump = <T>(map: Map<string, T>, key: string, init: T) => {
      if (!map.has(key)) map.set(key, init);
      return map.get(key)!;
    };

    for (const exec of executions) {
      totalRuns += 1;
      totalCost += exec.costUsd;
      totalImages += exec.images;
      totalTokensIn += exec.tokensIn;
      totalTokensOut += exec.tokensOut;
      const ok = exec.status === 'success';
      if (ok) totalOk += 1;
      totalLatency += exec.durationMs;

      const dk = this.dayKey(exec.startedAt);
      const day = bump(dayRuns, dk, { runs: 0, errors: 0, costUsd: 0 });
      day.runs += 1;
      day.costUsd += exec.costUsd;
      if (!ok) day.errors += 1;

      const wf = bump(workflowAgg, exec.workflow.id, {
        name: exec.workflow.name,
        runs: 0,
        ok: 0,
        latencyMs: 0,
        costUsd: 0,
      });
      wf.name = exec.workflow.name;
      wf.runs += 1;
      if (ok) wf.ok += 1;
      wf.latencyMs += exec.durationMs;
      wf.costUsd += exec.costUsd;

      if (exec.projectId) {
        const name =
          projectsById.get(exec.projectId)?.name ?? 'Deleted project';
        const pr = bump(projectAgg, exec.projectId, {
          name,
          runs: 0,
          client: 0,
          ok: 0,
          costUsd: 0,
        });
        pr.name = name;
        pr.runs += 1;
        if (exec.source === 'client') pr.client += 1;
        if (ok) pr.ok += 1;
        pr.costUsd += exec.costUsd;
      }

      if (exec.createdBy) {
        const u = usersById.get(exec.createdBy);
        const email = u?.email ?? 'Unknown user';
        const ug = bump(userAgg, exec.createdBy, {
          email,
          runs: 0,
          ok: 0,
          costUsd: 0,
        });
        ug.email = email;
        ug.runs += 1;
        if (ok) ug.ok += 1;
        ug.costUsd += exec.costUsd;
      }

      const attempts =
        (exec.attempts as Array<{
          provider?: string;
          model?: string;
          status?: string;
          latencyMs?: number;
          costUsd?: number;
        }> | null) ?? [];
      for (const attempt of attempts) {
        if (!attempt.provider) continue;
        const p = bump(providerAgg, attempt.provider, {
          runs: 0,
          ok: 0,
          fail: 0,
          latencyMs: 0,
          costUsd: 0,
        });
        p.runs += 1;
        if (attempt.status === 'success') p.ok += 1;
        else p.fail += 1;
        p.latencyMs += attempt.latencyMs ?? 0;
        p.costUsd += attempt.costUsd ?? 0;
        if (attempt.model) {
          const m = bump(modelAgg, attempt.model, {
            runs: 0,
            ok: 0,
            fail: 0,
            latencyMs: 0,
            costUsd: 0,
          });
          m.runs += 1;
          if (attempt.status === 'success') m.ok += 1;
          else m.fail += 1;
          m.latencyMs += attempt.latencyMs ?? 0;
          m.costUsd += attempt.costUsd ?? 0;
        }
      }
    }

    for (const record of usage) {
      const provider = providersById.get(record.providerId);
      const name = provider?.displayName ?? 'Unknown provider';
      const u = bump(usageAgg, record.providerId ?? name, {
        name,
        calls: 0,
        ok: 0,
        images: 0,
        costUsd: 0,
      });
      u.name = name;
      u.calls += 1;
      if (record.status === 'success') u.ok += 1;
      u.images += record.imageCount;
      u.costUsd += record.costUsd;
    }

    const daySeries: {
      date: string;
      runs: number;
      errors: number;
      costUsd: number;
    }[] = [];
    for (let i = daysSafe - 1; i >= 0; i--) {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      const key = this.dayKey(d);
      const cur = dayRuns.get(key) ?? { runs: 0, errors: 0, costUsd: 0 };
      daySeries.push({ date: key, ...cur });
    }

    const finish = <T extends { runs: number; latencyMs: number }>(
      arr: T[],
    ) => {
      return arr
        .sort((a, b) => b.runs - a.runs)
        .slice(0, 12)
        .map((item) => ({
          ...item,
          latencyMs: item.runs ? Math.round(item.latencyMs / item.runs) : 0,
        }));
    };

    return {
      days: daysSafe,
      from,
      overview: {
        runs: totalRuns,
        successRate: totalRuns ? Math.round((totalOk / totalRuns) * 100) : 0,
        costUsd: round4(totalCost),
        avgLatencyMs: totalRuns ? Math.round(totalLatency / totalRuns) : 0,
        images: totalImages,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        clientRuns: executions.filter((e) => e.source === 'client').length,
        adminRuns: executions.filter((e) => e.source === 'admin').length,
      },
      series: daySeries,
      providers: finish(
        [...providerAgg.entries()].map(([name, v]) => ({ name, ...v })),
      ),
      models: finish(
        [...modelAgg.entries()].map(([name, v]) => ({ name, ...v })),
      ),
      workflows: finish([...workflowAgg.values()]),
      projects: [...projectAgg.values()]
        .sort((a, b) => b.runs - a.runs)
        .slice(0, 12)
        .map((p) => ({
          ...p,
          clientRate: p.runs ? Math.round((p.client / p.runs) * 100) : 0,
        })),
      users: [...userAgg.values()].sort((a, b) => b.runs - a.runs).slice(0, 12),
      providerHealth: providers.map((p) => ({
        name: p.name,
        displayName: p.displayName,
        healthStatus: p.healthStatus,
        failureStreak: p.failureStreak,
      })),
      usage: [...usageAgg.values()]
        .sort((a, b) => b.calls - a.calls)
        .slice(0, 12),
    };
  }
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
