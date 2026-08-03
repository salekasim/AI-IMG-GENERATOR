import { Injectable, Logger } from '@nestjs/common';
import { AiProvider } from '@prisma/client';
import { PlatformConfigService } from '../../common/platform-config.service';
import { CryptoService } from '../../common/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProviderAdapterFactory } from '../../generation/adapters/provider-adapter.factory';
import { GenerationImage } from '../../generation/adapters/provider.adapter';
import { RulesService } from './rules.service';

export interface ChainStep {
  provider: string;
  model: string;
}

export interface RoutingAttempt {
  nodeId: string;
  provider: string;
  model: string;
  attempt: number;
  status: 'success' | 'error' | 'skipped';
  latencyMs: number;
  error?: string;
  costUsd: number;
}

export interface ImageRoutingRequest {
  nodeId: string;
  chain: ChainStep[];
  prompt: string;
  negativePrompt?: string;
  imageCount: number;
  size: { width: number; height: number };
  seed?: number;
}

export interface ImageRoutingResult {
  images: GenerationImage[];
  attempts: RoutingAttempt[];
  providerUsed: string | null;
  modelUsed: string | null;
  costUsd: number;
}

export interface RoutingEvent {
  nodeId: string;
  status: 'retrying' | 'skipped' | 'success' | 'error';
  attempt: number;
  provider?: string;
  model?: string;
  latencyMs: number;
  message?: string;
}

export interface RoutingSink {
  emit(event: RoutingEvent): void;
  log(
    level: 'info' | 'warn' | 'error' | 'success' | 'api',
    source: string,
    message: string,
  ): void;
}

export interface RoutingContext {
  /** User (or project owner for client runs) whose quota the attempts count against. */
  userId?: string | null;
}

const COOLDOWN_MS = 30_000;
const AUTO_DISABLE_STREAK = 3;

@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly adapterFactory: ProviderAdapterFactory,
    private readonly rules: RulesService,
    private readonly config: PlatformConfigService,
  ) {}

  private aliasFor(provider: string): string {
    const p = provider.trim().toLowerCase();
    if (['flux', 'ideogram'].includes(p)) return 'pollinations';
    return p;
  }

  private isInCooldown(row: AiProvider, fallbackCooldownMs: number): boolean {
    if (!row.failureStreak || !row.lastHealthCheck) return false;
    return (
      Date.now() - row.lastHealthCheck.getTime() <
      (row.cooldownMs || fallbackCooldownMs)
    );
  }

  /** Resolve a variable name to its ordered model fallback chain. */
  async resolveVariable(variable: string): Promise<ChainStep[]> {
    const row = await this.prisma.routingVariable.findUnique({
      where: { name: variable.trim().toUpperCase() },
      include: {
        routes: {
          orderBy: { order: 'asc' },
          include: { model: { include: { provider: true } } },
        },
      },
    });
    if (!row) return [];
    return row.routes.map((r) => ({
      provider: r.model.provider.name,
      model: r.model.internalName,
    }));
  }

  private async quotaFor(
    row: AiProvider,
  ): Promise<{ exceeded: boolean; reason?: string }> {
    if (row.dailyQuota || row.monthlyQuota) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const startOfMonth = new Date(
        startOfDay.getFullYear(),
        startOfDay.getMonth(),
        1,
      );
      const [todayCount, monthCount] = await Promise.all([
        row.dailyQuota
          ? this.prisma.usageRecord.count({
              where: { providerId: row.id, createdAt: { gte: startOfDay } },
            })
          : Promise.resolve(0),
        row.monthlyQuota
          ? this.prisma.usageRecord.count({
              where: { providerId: row.id, createdAt: { gte: startOfMonth } },
            })
          : Promise.resolve(0),
      ]);
      if (row.dailyQuota && todayCount >= row.dailyQuota) {
        return {
          exceeded: true,
          reason: `daily quota exhausted (${todayCount}/${row.dailyQuota})`,
        };
      }
      if (row.monthlyQuota && monthCount >= row.monthlyQuota) {
        return {
          exceeded: true,
          reason: `monthly quota exhausted (${monthCount}/${row.monthlyQuota})`,
        };
      }
    }
    return { exceeded: false };
  }

  /**
   * Run an image generation against an ordered chain of {provider, model}.
   * Every step is tracked; providers that are disabled, down, cooling down,
   * out of quota or without image capability are skipped; failures fall
   * through to the next step (or a rule-driven failover target); cost is
   * accumulated and usage is recorded for quota accounting.
   */
  async routeImage(
    req: ImageRoutingRequest,
    sink: RoutingSink,
    ctx?: RoutingContext,
  ): Promise<ImageRoutingResult> {
    const attempts: RoutingAttempt[] = [];
    const lastError: string[] = [];
    const steps: ChainStep[] = [...req.chain];
    const fallbackCooldownMs = await this.config.getNumber(
      'provider.cooldownMs',
      COOLDOWN_MS,
    );
    let i = 0;

    while (i < steps.length) {
      const step = steps[i];
      const attemptNumber = attempts.length + 1;
      const rowName = this.aliasFor(step.provider);

      const row = await this.prisma.aiProvider.findUnique({
        where: { name: rowName },
      });
      if (!row || !row.enabled) {
        attempts.push(
          this.record(
            req.nodeId,
            rowName,
            step.model,
            attemptNumber,
            'skipped',
            0,
            `provider '${rowName}' is missing or disabled`,
          ),
        );
        sink.emit({
          nodeId: req.nodeId,
          status: 'skipped',
          attempt: attemptNumber,
          provider: rowName,
          model: step.model,
          latencyMs: 0,
          message: `skipped — provider disabled`,
        });
        sink.log('warn', rowName, `↷ skipped (disabled) — ${step.model}`);
        i += 1;
        continue;
      }
      if (row.healthStatus === 'down') {
        attempts.push(
          this.record(
            req.nodeId,
            rowName,
            step.model,
            attemptNumber,
            'skipped',
            0,
            `provider '${rowName}' is marked down`,
          ),
        );
        sink.emit({
          nodeId: req.nodeId,
          status: 'skipped',
          attempt: attemptNumber,
          provider: rowName,
          model: step.model,
          latencyMs: 0,
          message: `skipped — provider down`,
        });
        sink.log('warn', rowName, `↷ skipped (down) — ${step.model}`);
        i += 1;
        continue;
      }
      if (this.isInCooldown(row, fallbackCooldownMs)) {
        const waitMs =
          (row.cooldownMs || fallbackCooldownMs) -
          (Date.now() - (row.lastHealthCheck?.getTime() ?? Date.now()));
        attempts.push(
          this.record(
            req.nodeId,
            rowName,
            step.model,
            attemptNumber,
            'skipped',
            0,
            `provider '${rowName}' cooling down (~${Math.ceil(waitMs / 1000)}s)`,
          ),
        );
        sink.emit({
          nodeId: req.nodeId,
          status: 'skipped',
          attempt: attemptNumber,
          provider: rowName,
          model: step.model,
          latencyMs: 0,
          message: `skipped — cooling down`,
        });
        sink.log(
          'warn',
          rowName,
          `↷ skipped (cooldown ${Math.ceil(waitMs / 1000)}s) — ${step.model}`,
        );
        i += 1;
        continue;
      }
      if (!row.supportsImages) {
        attempts.push(
          this.record(
            req.nodeId,
            rowName,
            step.model,
            attemptNumber,
            'skipped',
            0,
            `provider '${rowName}' has no image capability`,
          ),
        );
        sink.emit({
          nodeId: req.nodeId,
          status: 'skipped',
          attempt: attemptNumber,
          provider: rowName,
          model: step.model,
          latencyMs: 0,
          message: `skipped — no image support`,
        });
        sink.log(
          'warn',
          rowName,
          `↷ skipped (no image capability) — ${step.model}`,
        );
        i += 1;
        continue;
      }
      const quota = await this.quotaFor(row);
      if (quota.exceeded) {
        attempts.push(
          this.record(
            req.nodeId,
            rowName,
            step.model,
            attemptNumber,
            'skipped',
            0,
            `provider '${rowName}' — ${quota.reason}`,
          ),
        );
        sink.emit({
          nodeId: req.nodeId,
          status: 'skipped',
          attempt: attemptNumber,
          provider: rowName,
          model: step.model,
          latencyMs: 0,
          message: `skipped — ${quota.reason}`,
        });
        sink.log(
          'warn',
          rowName,
          `↷ skipped (${quota.reason}) — ${step.model}`,
        );
        i += 1;
        continue;
      }

      let adapter;
      try {
        adapter = this.adapterFactory.forProvider(row);
      } catch (error) {
        attempts.push(
          this.record(
            req.nodeId,
            rowName,
            step.model,
            attemptNumber,
            'error',
            0,
            error instanceof Error ? error.message : String(error),
          ),
        );
        sink.log(
          'error',
          rowName,
          `✗ no adapter — ${step.model}: ${error instanceof Error ? error.message : String(error)}`,
        );
        lastError.push(error instanceof Error ? error.message : String(error));
        i += 1;
        continue;
      }

      const startedAt = Date.now();
      sink.emit({
        nodeId: req.nodeId,
        status: 'retrying',
        attempt: attemptNumber,
        provider: rowName,
        model: step.model,
        latencyMs: 0,
        message: `trying ${rowName}/${step.model}`,
      });
      sink.log('info', rowName, `→ attempt ${attemptNumber}: ${step.model}`);
      try {
        const images = await adapter.generate(row, {
          prompt: req.prompt,
          negativePrompt: req.negativePrompt,
          imageCount: req.imageCount,
          size: req.size,
          seed: req.seed,
          model: step.model,
        });
        const latencyMs = Date.now() - startedAt;
        const costUsd = images.length * adapter.costPerImage;
        attempts.push(
          this.record(
            req.nodeId,
            rowName,
            step.model,
            attemptNumber,
            'success',
            latencyMs,
            undefined,
            costUsd,
          ),
        );
        sink.emit({
          nodeId: req.nodeId,
          status: 'success',
          attempt: attemptNumber,
          provider: rowName,
          model: step.model,
          latencyMs,
          message: `ok in ${latencyMs}ms`,
        });
        sink.log(
          'success',
          rowName,
          `✔ ${step.model} generated ${images.length} image(s) in ${latencyMs}ms ($${costUsd.toFixed(4)})`,
        );
        await this.recordUsage(
          row,
          ctx?.userId,
          req.prompt,
          images.length,
          costUsd,
          'success',
        );
        await this.recover(row.id, latencyMs);
        return {
          images,
          attempts,
          providerUsed: rowName,
          modelUsed: step.model,
          costUsd: this.sumCost(attempts),
        };
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        const message = error instanceof Error ? error.message : String(error);
        attempts.push(
          this.record(
            req.nodeId,
            rowName,
            step.model,
            attemptNumber,
            'error',
            latencyMs,
            message,
          ),
        );
        sink.emit({
          nodeId: req.nodeId,
          status: 'retrying',
          attempt: attemptNumber,
          provider: rowName,
          model: step.model,
          latencyMs,
          message: `failed — ${message.slice(0, 120)}`,
        });
        sink.log(
          'error',
          rowName,
          `✗ ${step.model} failed in ${latencyMs}ms: ${message.slice(0, 200)}`,
        );
        lastError.push(message);
        await this.recordUsage(row, ctx?.userId, req.prompt, 0, 0, 'error');
        await this.markFailure(row.id);

        const injected = await this.rules.applyFailover({
          chain: steps,
          failedIndex: i,
          provider: rowName,
          model: step.model,
        });
        if (injected.length) {
          steps.splice(i + 1, 0, ...injected);
          sink.log(
            'info',
            'rules',
            `rule failover → ${injected.map((s) => s.provider + '/' + s.model).join(', ')}`,
          );
          if (attempts.length > req.chain.length + 4) {
            sink.log(
              'error',
              'rules',
              'failover budget exceeded — stopping chain',
            );
            break;
          }
        }
        i += 1;
      }
    }

    const summary = lastError.join(' | ') || 'no usable providers in chain';
    throw new Error(
      `All ${req.chain.length} routing step(s) failed: ${summary}`,
    );
  }

  private async recordUsage(
    row: AiProvider,
    userId: string | undefined | null,
    prompt: string,
    imageCount: number,
    costUsd: number,
    status: 'success' | 'error',
  ) {
    if (!userId) return;
    try {
      await this.prisma.usageRecord.create({
        data: {
          userId,
          providerId: row.id,
          prompt: prompt.slice(0, 2000),
          imageCount,
          costUsd,
          status,
        },
      });
    } catch {
      // best-effort accounting
    }
  }

  private record(
    nodeId: string,
    provider: string,
    model: string,
    attempt: number,
    status: RoutingAttempt['status'],
    latencyMs: number,
    error?: string,
    costUsd = 0,
  ): RoutingAttempt {
    return {
      nodeId,
      provider,
      model,
      attempt,
      status,
      latencyMs,
      error,
      costUsd,
    };
  }

  private sumCost(attempts: RoutingAttempt[]): number {
    return attempts.reduce(
      (sum, a) => sum + (a.status === 'success' ? a.costUsd : 0),
      0,
    );
  }

  private async markFailure(id: string) {
    try {
      const row = await this.prisma.aiProvider.findUnique({ where: { id } });
      if (!row) return;
      const streak = row.failureStreak + 1;
      await this.prisma.aiProvider.update({
        where: { id },
        data: {
          failureStreak: streak,
          lastHealthCheck: new Date(),
          healthStatus: streak >= AUTO_DISABLE_STREAK ? 'down' : 'degraded',
        },
      });
      if (streak >= AUTO_DISABLE_STREAK) {
        this.logger.warn(
          `provider ${row.name} auto-disabled after ${streak} consecutive failures`,
        );
      }
    } catch {
      // best-effort
    }
  }

  private async recover(id: string, latencyMs: number) {
    try {
      await this.prisma.aiProvider.update({
        where: { id },
        data: {
          failureStreak: 0,
          lastHealthCheck: new Date(),
          healthStatus: latencyMs > 5000 ? 'degraded' : 'healthy',
        },
      });
    } catch {
      // best-effort
    }
  }
}
