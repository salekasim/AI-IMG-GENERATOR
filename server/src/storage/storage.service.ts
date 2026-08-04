import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Prisma, StorageProvider } from '@prisma/client';
import { CryptoService } from '../common/crypto.service';
import { PlatformConfigService } from '../common/platform-config.service';
import { PrismaService } from '../prisma/prisma.service';

export interface PersistAssetInput {
  executionId?: string | null;
  workflowId?: string | null;
  nodeId?: string | null;
  tool: string;
  provider?: string | null;
  model?: string | null;
  kind: 'image' | 'video' | 'audio' | 'file';
  mime?: string | null;
  buffer: Buffer;
  ext?: string;
  createdBy?: string | null;
  /** Named StorageProvider route (from the storage node config). */
  route?: string | null;
  /** Folder / path override (from the storage node config). */
  path?: string | null;
}

export interface PersistedAsset {
  id: string;
  url: string | null;
  localPath: string | null;
  sizeBytes: number;
  mime: string | null;
  kind: string;
}

export type StorageDriver = 'local' | 'cloudinary' | 'auto';

/**
 * Storage backend abstraction.
 *
 * Drivers:
 *  - `local`: writes to a configurable directory (default ./uploads).
 *  - `cloudinary`: uploads to Cloudinary using CLOUDINARY_CLOUD_NAME /
 *    CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET env vars (server-side only).
 *    The API secret is never exposed to the frontend — it is read from the
 *    process environment and only used for signed upload/delete calls.
 *  - `auto` (default): cloudinary when env vars are present, else local.
 *
 * Driver is selected via the `storage.driver` platform setting or the
 * STORAGE_DRIVER env var.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PlatformConfigService,
    private readonly crypto: CryptoService,
  ) {}

  async onModuleInit() {
    const driver = await this.resolveDriver();
    if (driver === 'cloudinary') {
      this.configureCloudinary();
      this.logger.log(
        `storage driver: cloudinary (cloud ${this.cloudinaryName()})`,
      );
      return;
    }
    const dir = await this.storageDir();
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      this.logger.warn(`cannot create storage dir ${dir}: ${String(error)}`);
    }
  }

  // ---------------------------------------------------------------- driver

  private cloudinaryName(): string {
    return process.env.CLOUDINARY_CLOUD_NAME ?? '';
  }

  private cloudinaryConfigured(): boolean {
    return Boolean(
      this.cloudinaryName() &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
    );
  }

  private configureCloudinary(): void {
    cloudinary.config({
      cloud_name: this.cloudinaryName(),
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  private async resolveDriver(): Promise<StorageDriver> {
    const setting = await this.config.getString(
      'storage.driver',
      process.env.STORAGE_DRIVER ?? 'auto',
    );
    const value = setting as StorageDriver;
    if (value === 'cloudinary') return 'cloudinary';
    if (value === 'auto' && this.cloudinaryConfigured()) return 'cloudinary';
    if (value === 'auto') return 'local';
    if (value === 'local') return 'local';
    throw new Error(
      `Unknown storage driver '${String(value)}'. Use 'local', 'cloudinary' or 'auto'.`,
    );
  }

  private async storageDir(): Promise<string> {
    const configured = await this.config.getString('storage.localPath', '');
    return configured ? configured : path.resolve(process.cwd(), 'uploads');
  }

  // ------------------------------------------------------------ providers

  private decryptProviderConfig(row: StorageProvider): Record<string, unknown> {
    if (!row.configEnc) return {};
    try {
      return JSON.parse(
        this.crypto.decrypt(String(row.configEnc)),
      ) as Record<string, unknown>;
    } catch {
      this.logger.warn(
        `storage provider '${row.name}' has an unreadable encrypted config`,
      );
      return {};
    }
  }

  /**
   * Resolve the storage backend for a persist call:
   *  1. named route (storage node `storage` config), when enabled
   *  2. the active enabled provider, else highest-priority enabled provider
   *  3. legacy env/platform-config fallback (local | cloudinary | auto)
   */
  private async resolveStorage(route?: string | null): Promise<{
    providerId: string | null;
    driver: 'local' | 'cloudinary';
    config: Record<string, unknown>;
  }> {
    let row: StorageProvider | null = null;
    if (route && route.trim()) {
      row = await this.prisma.storageProvider.findFirst({
        where: { name: route.trim() },
      });
      if (row && !row.enabled) {
        this.logger.warn(
          `storage route '${row.name}' is disabled — falling back to active provider`,
        );
        row = null;
      }
    }
    if (!row) {
      row = await this.prisma.storageProvider.findFirst({
        where: { enabled: true },
        orderBy: [{ isActive: 'desc' }, { priority: 'asc' }],
      });
    }
    if (row) {
      const config = this.decryptProviderConfig(row);
      if (row.driver === 'cloudinary') {
        return { providerId: row.id, driver: 'cloudinary', config };
      }
      if (row.driver === 'local') {
        return { providerId: row.id, driver: 'local', config };
      }
      throw new BadRequestException(
        `Storage driver '${row.driver}' is not implemented (provider '${row.name}')`,
      );
    }
    const driver = await this.resolveDriver();
    return {
      providerId: null,
      driver: driver as 'local' | 'cloudinary',
      config: {
        cloudName: this.cloudinaryName(),
        apiKey: process.env.CLOUDINARY_API_KEY ?? null,
        apiSecret: process.env.CLOUDINARY_API_SECRET ?? null,
        folder: process.env.CLOUDINARY_FOLDER ?? 'ai-img-generator',
      },
    };
  }

  listProviders() {
    return this.prisma.storageProvider.findMany({
      orderBy: [{ isActive: 'desc' }, { priority: 'asc' }],
    });
  }

  async createProvider(dto: {
    name: string;
    driver: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
    isActive?: boolean;
    priority?: number;
  }) {
    const existing = await this.prisma.storageProvider.findFirst({
      where: { name: dto.name.trim() },
    });
    if (existing) {
      throw new BadRequestException(
        `Storage provider '${dto.name}' already exists`,
      );
    }
    const configJson =
      dto.config && Object.keys(dto.config).length
        ? this.crypto.encrypt(JSON.stringify(dto.config))
        : null;
    return this.prisma.$transaction(async (tx) => {
      if (dto.isActive) {
        await tx.storageProvider.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        });
      }
      return tx.storageProvider.create({
        data: {
          name: dto.name.trim(),
          driver: dto.driver,
          configEnc: (configJson ?? Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
          enabled: dto.enabled ?? true,
          isActive: dto.isActive ?? false,
          priority: dto.priority ?? 0,
        },
      });
    });
  }

  async updateProvider(
    id: string,
    dto: {
      name?: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
      isActive?: boolean;
      priority?: number;
    },
  ) {
    const existing = await this.prisma.storageProvider.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Storage provider not found');
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.config !== undefined) {
      data.configEnc = Object.keys(dto.config).length
        ? this.crypto.encrypt(JSON.stringify(dto.config))
        : null;
    }
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return this.prisma.$transaction(async (tx) => {
      if (dto.isActive) {
        await tx.storageProvider.updateMany({
          where: { isActive: true, id: { not: id } },
          data: { isActive: false },
        });
      }
      return tx.storageProvider.update({ where: { id }, data });
    });
  }

  async deleteProvider(id: string) {
    const existing = await this.prisma.storageProvider.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Storage provider not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.storageProvider.delete({ where: { id } });
      if (existing.isActive) {
        const next = await tx.storageProvider.findFirst({
          where: { enabled: true },
          orderBy: [{ isActive: 'desc' }, { priority: 'asc' }, { createdAt: 'asc' }],
        });
        if (next) {
          await tx.storageProvider.update({
            where: { id: next.id },
            data: { isActive: true },
          });
          this.logger.log(
            `Storage provider '${existing.name}' (active) deleted — promoted '${next.name}' to active`,
          );
        }
      }
    });
    return true;
  }

  async testProvider(id: string) {
    const row = await this.prisma.storageProvider.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Storage provider not found');
    const config = this.decryptProviderConfig(row);
    const startedAt = Date.now();
    try {
      if (row.driver === 'cloudinary') {
        const { cloudName, apiKey, apiSecret } = config as {
          cloudName?: string;
          apiKey?: string;
          apiSecret?: string;
        };
        if (!cloudName || !apiKey || !apiSecret) {
          return {
            ok: false,
            latencyMs: Date.now() - startedAt,
            message: 'cloudinary config is incomplete (cloudName/apiKey/apiSecret)',
          };
        }
        cloudinary.config({
          cloud_name: cloudName,
          api_key: apiKey,
          api_secret: apiSecret,
          secure: true,
        });
        await cloudinary.api.ping();
        return {
          ok: true,
          latencyMs: Date.now() - startedAt,
          message: `cloudinary reachable (cloud '${cloudName}')`,
        };
      }
      if (row.driver === 'local') {
        const dir = String(config.path ?? '') || (await this.storageDir());
        await fs.mkdir(dir, { recursive: true });
        return {
          ok: true,
          latencyMs: Date.now() - startedAt,
          message: `local directory writable (${dir})`,
        };
      }
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        message: `driver '${row.driver}' is not implemented`,
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private safeName(ext: string): string {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}${ext}`;
  }

  private async cloudinaryFolder(): Promise<string> {
    const configured = await this.config.getString(
      'storage.cloudinaryFolder',
      '',
    );
    return configured || process.env.CLOUDINARY_FOLDER || 'ai-img-generator';
  }

  private resourceType(kind: string): 'image' | 'video' | 'raw' {
    if (kind === 'image') return 'image';
    if (kind === 'video') return 'video';
    return 'raw';
  }

  // ---------------------------------------------------------------- upload

  private uploadToCloudinary(
    buffer: Buffer,
    folder: string,
    kind: string,
    mime?: string | null,
  ): Promise<{ publicId: string; secureUrl: string }> {
    const fallbackMime =
      kind === 'image'
        ? 'image/png'
        : kind === 'video'
          ? 'video/mp4'
          : 'application/octet-stream';
    const dataUri = `data:${mime ?? fallbackMime};base64,${buffer.toString('base64')}`;
    return cloudinary.uploader
      .upload(dataUri, {
        folder,
        resource_type: this.resourceType(kind),
        type: 'upload',
      })
      .then((result) => ({
        publicId: result.public_id,
        secureUrl: result.secure_url,
      }));
  }

  async persist(input: PersistAssetInput): Promise<PersistedAsset> {
    const { providerId, driver, config } = await this.resolveStorage(input.route);

    if (driver === 'cloudinary') {
      const { cloudName, apiKey, apiSecret } = config as {
        cloudName?: string;
        apiKey?: string;
        apiSecret?: string;
      };
      if (cloudName && apiKey && apiSecret) {
        cloudinary.config({
          cloud_name: cloudName,
          api_key: apiKey,
          api_secret: apiSecret,
          secure: true,
        });
      } else {
        this.configureCloudinary();
      }
      try {
        const folder =
          input.path?.trim() ||
          String(config.folder ?? '') ||
          (providerId ? 'ai-img-generator' : await this.cloudinaryFolder());
        const { publicId, secureUrl } = await this.uploadToCloudinary(
          input.buffer,
          folder,
          input.kind,
          input.mime,
        );
        const asset = await this.prisma.storageAsset.create({
          data: {
            executionId: input.executionId ?? null,
            workflowId: input.workflowId ?? null,
            nodeId: input.nodeId ?? null,
            tool: input.tool,
            provider: input.provider ?? null,
            model: input.model ?? null,
            kind: input.kind,
            mime: input.mime ?? null,
            url: secureUrl,
            cloudinaryPublicId: publicId,
            storageProviderId: providerId,
            sizeBytes: input.buffer.length,
            createdBy: input.createdBy ?? null,
          },
        });
        this.logger.log(
          `stored ${input.kind} asset ${asset.id} on cloudinary${providerId ? ` (${providerId})` : ''} (${input.buffer.length} bytes)`,
        );
        return {
          id: asset.id,
          url: secureUrl,
          localPath: null,
          sizeBytes: input.buffer.length,
          mime: input.mime ?? null,
          kind: input.kind,
        };
      } catch (error) {
        this.logger.error(
          `cloudinary upload failed: ${String(error)}; falling back to local driver`,
        );
      }
    }

    const dir =
      String(config.path ?? '').trim() ||
      (await this.storageDir());
    const ext = input.ext ?? (input.kind === 'image' ? '.png' : '.bin');
    const fileName = this.safeName(ext);
    const fullPath = path.join(dir, fileName);

    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, input.buffer);
    } catch (error) {
      this.logger.error(`local write failed: ${String(error)}`);
      throw new Error(`Storage write failed: ${String(error)}`);
    }

    const asset = await this.prisma.storageAsset.create({
      data: {
        executionId: input.executionId ?? null,
        workflowId: input.workflowId ?? null,
        nodeId: input.nodeId ?? null,
        tool: input.tool,
        provider: input.provider ?? null,
        model: input.model ?? null,
        kind: input.kind,
        mime: input.mime ?? null,
        localPath: fullPath,
        storageProviderId: providerId,
        sizeBytes: input.buffer.length,
        createdBy: input.createdBy ?? null,
      },
    });

    this.logger.log(
      `stored ${input.kind} asset ${asset.id}${providerId ? ` on ${providerId}` : ''} (${input.buffer.length} bytes)`,
    );
    return {
      id: asset.id,
      url: null,
      localPath: fullPath,
      sizeBytes: input.buffer.length,
      mime: input.mime ?? null,
      kind: input.kind,
    };
  }

  // ---------------------------------------------------------------- list

  list(limit = 100, offset = 0) {
    return this.prisma.storageAsset.findMany({
      orderBy: { createdAt: 'desc' },
      skip: Math.max(0, offset),
      take: Math.min(500, Math.max(1, limit)),
    });
  }

  // ---------------------------------------------------------------- read

  async readFile(id: string): Promise<{ buffer: Buffer; mime: string | null }> {
    const asset = await this.prisma.storageAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.url) {
      const response = await fetch(asset.url);
      if (!response.ok) {
        throw new Error(`Cannot fetch remote asset: HTTP ${response.status}`);
      }
      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        mime: asset.mime,
      };
    }
    if (!asset.localPath) throw new NotFoundException('Asset has no file');
    const buffer = await fs.readFile(asset.localPath);
    return { buffer, mime: asset.mime };
  }

  /** Public file URL for an asset, or null when only stored locally. */
  async getPublicUrl(id: string): Promise<string | null> {
    const asset = await this.prisma.storageAsset.findUnique({ where: { id } });
    return asset?.url ?? null;
  }

  // ---------------------------------------------------------------- delete

  async remove(id: string) {
    const asset = await this.prisma.storageAsset.findUnique({ where: { id } });
    if (!asset) return false;

    if (asset.cloudinaryPublicId) {
      try {
        this.configureCloudinary();
        const result = (await cloudinary.uploader.destroy(
          asset.cloudinaryPublicId,
          {
            resource_type: this.resourceType(asset.kind),
            type: 'upload',
          },
        )) as { result?: string } | undefined;
        const outcome = result?.result;
        if (outcome !== 'ok' && outcome !== 'not found') {
          this.logger.warn(
            `cloudinary destroy returned '${String(outcome ?? 'unknown')}' for ${asset.cloudinaryPublicId}`,
          );
        } else {
          this.logger.log(
            `deleted cloudinary asset ${asset.cloudinaryPublicId}`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `cloudinary delete failed for ${asset.cloudinaryPublicId}: ${String(error)}`,
        );
      }
    }

    if (asset.localPath) {
      try {
        await fs.unlink(asset.localPath);
      } catch {
        // file already gone — still remove the row
      }
    }

    await this.prisma.storageAsset.delete({ where: { id } });
    return true;
  }
}
