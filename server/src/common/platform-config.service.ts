import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface PlatformSettingDef {
  key: string;
  type: 'number' | 'boolean' | 'string' | 'json' | 'days-or-never';
  fallback: JsonValue;
}

export const PLATFORM_SETTINGS: PlatformSettingDef[] = [
  // Audit
  { key: 'audit.retentionDays', type: 'days-or-never', fallback: null },
  // User defaults & limits
  { key: 'users.defaultDailyQuota', type: 'number', fallback: 20 },
  { key: 'users.maxImagesPerRun', type: 'number', fallback: 4 },
  { key: 'users.defaultResolution', type: 'string', fallback: 'medium' },
  { key: 'users.allowHighResolution', type: 'boolean', fallback: true },
  { key: 'users.allowMediumResolution', type: 'boolean', fallback: true },
  { key: 'users.allowLowResolution', type: 'boolean', fallback: true },
  { key: 'users.defaultRatio', type: 'string', fallback: '1:1' },
  // Resolution presets
  {
    key: 'generation.resolutions',
    type: 'json',
    fallback: {
      high: { enabled: true, scale: 1 },
      medium: { enabled: true, scale: 0.75 },
      low: { enabled: true, scale: 0.5 },
    },
  },
  // Health & routing
  { key: 'health.pingMs', type: 'number', fallback: 300_000 },
  { key: 'provider.cooldownMs', type: 'number', fallback: 30_000 },
  { key: 'routing.maxChainDepth', type: 'number', fallback: 4 },
  { key: 'execution.timeoutMs', type: 'number', fallback: 300_000 },
  // Storage (storage node / asset persistence)
  { key: 'storage.driver', type: 'string', fallback: 'auto' }, // local | cloudinary | auto
  { key: 'storage.localPath', type: 'string', fallback: '' },
  { key: 'storage.cloudinaryFolder', type: 'string', fallback: '' },
  { key: 'storage.bucket', type: 'string', fallback: '' },
  { key: 'storage.endpoint', type: 'string', fallback: '' },
  { key: 'storage.accessKey', type: 'string', fallback: '' },
  { key: 'storage.secretKey', type: 'string', fallback: '' },
  { key: 'storage.publicUrl', type: 'string', fallback: '' },
];

const RESOLUTION_KEYS = ['high', 'medium', 'low'] as const;
export type ResolutionTier = (typeof RESOLUTION_KEYS)[number];

export function isResolutionTier(value: unknown): value is ResolutionTier {
  return (
    typeof value === 'string' &&
    (RESOLUTION_KEYS as readonly string[]).includes(value)
  );
}

@Injectable()
export class PlatformConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getRaw(key: string): Promise<JsonValue | undefined> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return (row?.value as JsonValue | undefined) ?? undefined;
  }

  async getNumber(key: string, fallback: number): Promise<number> {
    const value = await this.getRaw(key);
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : fallback;
  }

  async getBoolean(key: string, fallback: boolean): Promise<boolean> {
    const value = await this.getRaw(key);
    return typeof value === 'boolean' ? value : fallback;
  }

  async getString(key: string, fallback: string): Promise<string> {
    const value = await this.getRaw(key);
    return typeof value === 'string' ? value : fallback;
  }

  async getJson<T>(key: string, fallback: T): Promise<T> {
    const value = await this.getRaw(key);
    if (value !== undefined && typeof value === 'object' && value !== null) {
      return value as T;
    }
    return fallback;
  }

  /** audit.retentionDays: number of days or null = never expire */
  async getAuditRetentionDays(): Promise<number | null> {
    const value = await this.getRaw('audit.retentionDays');
    if (value === null) return null;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    return null;
  }

  /** Generation size multiplier per resolution tier. */
  async getResolutionScale(tier: ResolutionTier): Promise<number> {
    const presets = await this.getJson<
      Record<string, { enabled?: boolean; scale?: number }>
    >('generation.resolutions', {});
    const preset = presets[tier];
    if (preset && typeof preset.scale === 'number' && preset.scale > 0) {
      return preset.scale;
    }
    return 1;
  }

  async isResolutionEnabled(tier: ResolutionTier): Promise<boolean> {
    const presets = await this.getJson<
      Record<string, { enabled?: boolean; scale?: number }>
    >('generation.resolutions', {});
    const preset = presets[tier];
    return preset?.enabled ?? true;
  }

  async isResolutionAllowedForUser(
    tier: ResolutionTier,
    isAdmin: boolean,
  ): Promise<boolean> {
    if (isAdmin) return true;
    const key = `users.allow${tier.charAt(0).toUpperCase()}${tier.slice(1)}Resolution`;
    return this.getBoolean(key, true);
  }
}
