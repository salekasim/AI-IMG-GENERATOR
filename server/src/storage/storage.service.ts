import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { promises as fs } from 'fs';
import * as path from 'path';
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
    const driver = await this.resolveDriver();

    if (driver === 'cloudinary') {
      this.configureCloudinary();
      try {
        const folder = await this.cloudinaryFolder();
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
            sizeBytes: input.buffer.length,
            createdBy: input.createdBy ?? null,
          },
        });
        this.logger.log(
          `stored ${input.kind} asset ${asset.id} on cloudinary (${input.buffer.length} bytes)`,
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

    const dir = await this.storageDir();
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
        sizeBytes: input.buffer.length,
        createdBy: input.createdBy ?? null,
      },
    });

    this.logger.log(
      `stored ${input.kind} asset ${asset.id} (${input.buffer.length} bytes)`,
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
