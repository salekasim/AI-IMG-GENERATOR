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
  /** Credential pool label used for the attempt, when one was used. */
  credentialLabel?: string;
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

  /**
   * Ordered credential pool for a provider row. Empty when the provider only
   * has the legacy single `apiKeyEnc`.
   */
  async credentialPoolFor(row: AiProvider) {
    return this.prisma.providerCredential.findMany({
      where: { providerId: row.id, enabled: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Best available credential for a provider (by priority / lowest streak).
   * Falls back to the provider's own apiKeyEnc when no pool exists.
   * Used by adapter paths outside routeImage (e.g. video).
   */
  async bestCredentialFor(providerName: string): Promise<{
    apiKeyEnc: string | null;
    label: string | null;
  }> {
    const row = await this.prisma.aiProvider.findUnique({
      where: { name: this.aliasFor(providerName) },
    });
    if (!row) return { apiKeyEnc: null, label: null };
    const pool = await this.credentialPoolFor(row);
    if (pool.length) {
      return { apiKeyEnc: pool[0].apiKeyEnc, label: pool[0].label };
    }
    return { apiKeyEnc: row.apiKeyEnc, label: null };
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
        attempt: attempts.length + 1,
        provider: rowName,
        model: step.model,
        latencyMs: 0,
        message: `trying ${rowName}/${step.model}`,
      });
      sink.log('info', rowName, `→ attempt ${attemptNumber}: ${step.model}`);

      // Credential rotation: try every enabled credential of this provider
      // (by priority) before declaring the step failed and moving to the next
      // provider in the chain. No pool → legacy single apiKeyEnc.
      const pool = await this.credentialPoolFor(row);
      const candidates: Array<{
        id: string | null;
        apiKeyEnc: string | null;
        label: string | null;
      }> = pool.length
        ? pool.map((c) => ({ id: c.id, apiKeyEnc: c.apiKeyEnc, label: c.label }))
        : [{ id: null, apiKeyEnc: row.apiKeyEnc, label: null }];

      let stepFailedMessage: string | null = null;
      let stepFailedLatency = 0;
      for (const candidate of candidates) {
        const candidateAttempt = attempts.length + 1;
        const providerForCall: AiProvider = {
          ...row,
          apiKeyEnc: candidate.apiKeyEnc,
        };
        const candidateStart = Date.now();
        sink.emit({
          nodeId: req.nodeId,
          status: 'retrying',
          attempt: candidateAttempt,
          provider: rowName,
          model: step.model,
          latencyMs: 0,
          message: candidate.label
            ? `trying ${rowName}/${step.model} (${candidate.label})`
            : `trying ${rowName}/${step.model}`,
        });
        if (candidate.label) {
          sink.log(
            'info',
            rowName,
            `→ attempt ${candidateAttempt}: ${step.model} via credential '${candidate.label}'`,
          );
        }
        try {
          const images = await adapter.generate(providerForCall, {
            prompt: req.prompt,
            negativePrompt: req.negativePrompt,
            imageCount: req.imageCount,
            size: req.size,
            seed: req.seed,
            model: step.model,
          });
          const latencyMs = Date.now() - candidateStart;
          const costUsd = images.length * adapter.costPerImage;
          attempts.push(
            this.record(
              req.nodeId,
              rowName,
              step.model,
              candidateAttempt,
              'success',
              latencyMs,
              undefined,
              costUsd,
              candidate.label ?? undefined,
            ),
          );
          sink.emit({
            nodeId: req.nodeId,
            status: 'success',
            attempt: candidateAttempt,
            provider: rowName,
            model: step.model,
            latencyMs,
            message: `ok in ${latencyMs}ms`,
          });
          sink.log(
            'success',
            rowName,
            `✔ ${step.model} generated ${images.length} image(s) in ${latencyMs}ms ($${costUsd.toFixed(4)})${candidate.label ? ` via '${candidate.label}'` : ''}`,
          );
          if (candidate.label && candidate.id) {
            await this.credentialRecover(candidate.id);
          }
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
          const latencyMs = Date.now() - candidateStart;
          const message = error instanceof Error ? error.message : String(error);
          attempts.push(
            this.record(
              req.nodeId,
              rowName,
              step.model,
              candidateAttempt,
              'error',
              latencyMs,
              message,
              0,
              candidate.label ?? undefined,
            ),
          );
          sink.emit({
            nodeId: req.nodeId,
            status: 'retrying',
            attempt: candidateAttempt,
            provider: rowName,
            model: step.model,
            latencyMs,
            message: `failed — ${message.slice(0, 120)}`,
          });
          if (candidate.label && candidate.id) {
            await this.credentialFail(candidate.id, message);
            sink.log(
              'error',
              rowName,
              `✗ credential '${candidate.label}' failed in ${latencyMs}ms: ${message.slice(0, 160)}`,
            );
          } else {
            sink.log(
              'error',
              rowName,
              `✗ ${step.model} failed in ${latencyMs}ms: ${message.slice(0, 200)}`,
            );
          }
          lastError.push(message);
          stepFailedMessage = message;
          stepFailedLatency = latencyMs;
        }
      }

      // Every credential (or the single legacy key) failed for this step.
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
    credentialLabel?: string,
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
      credentialLabel,
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

  private async credentialRecover(credentialId: string) {
    try {
      await this.prisma.providerCredential.update({
        where: { id: credentialId },
        data: { failureStreak: 0, lastError: null, lastUsedAt: new Date() },
      });
    } catch {
      // best-effort
    }
  }

  private async credentialFail(credentialId: string, message: string) {
    try {
      const row = await this.prisma.providerCredential.findUnique({
        where: { id: credentialId },
      });
      if (!row) return;
      const streak = row.failureStreak + 1;
      await this.prisma.providerCredential.update({
        where: { id: credentialId },
        data: {
          failureStreak: streak,
          lastError: message.slice(0, 300),
          lastUsedAt: new Date(),
        },
      });
      if (streak >= 5) {
        this.logger.warn(
          `credential '${row.label}' (${row.providerId}) auto-disabled after ${streak} consecutive failures`,
        );
      }
    } catch {
      // best-effort
    }
  }
}
