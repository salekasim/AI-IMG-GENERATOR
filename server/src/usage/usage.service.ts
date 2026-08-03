import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  countToday(userId: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return this.prisma.usageRecord.count({
      where: {
        userId,
        status: 'success',
        createdAt: { gte: startOfDay },
      },
    });
  }

  record(input: {
    userId: string;
    providerId: string;
    prompt: string;
    imageCount: number;
    costUsd: number;
    status: string;
  }) {
    return this.prisma.usageRecord.create({ data: input });
  }

  async myUsage(userId: string, quota: number) {
    const usedToday = await this.countToday(userId);
    return {
      usedToday,
      quota,
      remaining: Math.max(0, quota - usedToday),
    };
  }
}
