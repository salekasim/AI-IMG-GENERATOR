import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(actorId: string | null, action: string, detail?: unknown) {
    return this.prisma.auditLog.create({
      data: {
        actorId,
        action,
        detail: detail ?? undefined,
      },
    });
  }

  async list(limit = 100) {
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    const entries = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
      include: { actor: { select: { email: true } } },
    });
    return entries.map((e) => ({
      id: e.id,
      action: e.action,
      detail: e.detail,
      createdAt: e.createdAt,
      actorEmail: e.actor?.email ?? null,
    }));
  }

  /** Delete every audit log entry (used by the admin "clear logs" action). */
  async clear(): Promise<number> {
    const result = await this.prisma.auditLog.deleteMany({});
    return result.count;
  }

  /** Delete audit entries older than the given cutoff. */
  async prune(before: Date): Promise<number> {
    const result = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: before } },
    });
    return result.count;
  }

  async count(): Promise<number> {
    return this.prisma.auditLog.count();
  }
}
