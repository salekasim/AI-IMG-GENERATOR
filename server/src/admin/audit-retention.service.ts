import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PlatformConfigService } from '../common/platform-config.service';
import { AuditService } from './audit.service';

const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

/**
 * Enforces the 'audit.retentionDays' platform setting: when set to a number,
 * audit logs older than that many days are deleted. null (default) = keep
 * forever. Re-reads the setting on every tick so admin changes apply live.
 */
@Injectable()
export class AuditRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditRetentionService.name);
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    private readonly audit: AuditService,
    private readonly config: PlatformConfigService,
  ) {}

  onModuleInit() {
    void this.prune();
    this.timer = setInterval(() => void this.prune(), PRUNE_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  async prune(): Promise<void> {
    if (this.stopped) return;
    const retentionDays = await this.config.getAuditRetentionDays();
    if (retentionDays === null) return;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const removed = await this.audit.prune(cutoff);
    if (removed > 0) {
      this.logger.log(`pruned ${removed} audit log(s) older than ${retentionDays} day(s)`);
    }
  }
}
