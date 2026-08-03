import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AiProvider } from '@prisma/client';
import { PlatformConfigService } from '../../common/platform-config.service';
import { PrismaService } from '../../prisma/prisma.service';

const PING_TIMEOUT_MS = 8_000;
const DOWN_STREAK = 3;

/**
 * Periodically pings every enabled provider root URL and updates
 * healthStatus / failureStreak / lastHealthCheck so the routing layer can
 * skip unhealthy providers and recover automatically once they respond again.
 * The ping interval is read live from the 'health.pingMs' platform setting
 * (default 300s) so admin changes apply without a restart.
 */
@Injectable()
export class HealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthService.name);
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PlatformConfigService,
  ) {}

  onModuleInit() {
    void this.schedule();
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async schedule(): Promise<void> {
    if (this.stopped) return;
    const interval = await this.config.getNumber(
      'health.pingMs',
      Number(process.env.HEALTH_PING_MS ?? 300_000),
    );
    const safe = Math.max(Math.min(interval, 86_400_000), 5_000);
    this.timer = setTimeout(() => {
      void this.pingAll().finally(() => void this.schedule());
    }, safe);
    this.timer.unref?.();
    void this.pingAll();
  }

  async pingAll(): Promise<void> {
    const providers = await this.prisma.aiProvider.findMany({ where: { enabled: true } });
    for (const provider of providers) {
      try {
        await this.ping(provider);
      } catch {
        // per-provider failures are handled inside ping()
      }
    }
  }

  private async ping(row: AiProvider): Promise<void> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    let reachable = false;
    try {
      const response = await fetch(this.rootUrl(row.baseUrl), {
        method: 'GET',
        signal: controller.signal,
        headers: { 'user-agent': 'intellix-health', accept: '*/*' },
      });
      reachable = response.status < 500;
    } catch {
      reachable = false;
    } finally {
      clearTimeout(timeout);
    }
    const latencyMs = Date.now() - startedAt;

    const current = await this.prisma.aiProvider.findUnique({ where: { id: row.id } });
    if (!current) return;

    if (reachable) {
      await this.prisma.aiProvider.update({
        where: { id: row.id },
        data: {
          healthStatus: latencyMs > 5000 ? 'degraded' : 'healthy',
          failureStreak: 0,
          lastHealthCheck: new Date(),
        },
      });
      if (current.healthStatus !== 'healthy') {
        this.logger.log(`provider ${row.name} is healthy again (${latencyMs}ms)`);
      }
      return;
    }

    const streak = current.failureStreak + 1;
    const healthStatus = streak >= DOWN_STREAK ? 'down' : 'degraded';
    await this.prisma.aiProvider.update({
      where: { id: row.id },
      data: { healthStatus, failureStreak: streak, lastHealthCheck: new Date() },
    });
    if (healthStatus === 'down') {
      this.logger.warn(`provider ${row.name} marked down after ${streak} failed health checks`);
    }
  }

  private rootUrl(baseUrl: string): string {
    try {
      const url = new URL(baseUrl);
      return `${url.protocol}//${url.host}/`;
    } catch {
      return baseUrl;
    }
  }
}
