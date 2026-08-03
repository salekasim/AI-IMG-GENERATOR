import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<Record<string, unknown>> {
    const settings = await this.prisma.setting.findMany();
    const map: Record<string, unknown> = {};
    for (const setting of settings) {
      map[setting.key] = setting.value;
    }
    return map;
  }

  async get(key: string, fallback: unknown): Promise<unknown> {
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    return setting ? setting.value : fallback;
  }

  async set(key: string, value: unknown) {
    await this.prisma.setting.upsert({
      where: { key },
      update: { value: value as Prisma.InputJsonValue },
      create: { key, value: value as Prisma.InputJsonValue },
    });
    return { key, value };
  }
}
