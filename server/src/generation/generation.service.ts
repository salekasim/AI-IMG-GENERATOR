import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  isResolutionTier,
  PlatformConfigService,
  ResolutionTier,
} from '../common/platform-config.service';
import { ProvidersService } from '../providers/providers.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { UsageService } from '../usage/usage.service';
import { ProviderAdapterFactory } from './adapters/provider-adapter.factory';
import {
  GenerationImage,
  GenerationRequest,
} from './adapters/provider.adapter';
import { GenerateDto } from './dto/generate.dto';
import { sizeFor } from './ratio';

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    private readonly providers: ProvidersService,
    private readonly users: UsersService,
    private readonly usage: UsageService,
    private readonly adapterFactory: ProviderAdapterFactory,
    private readonly config: PlatformConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async availableModels() {
    return this.providers.listForPicker();
  }

  async history(userId: string, limit = 30, offset = 0) {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.generation.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: Math.max(0, offset),
        take: Math.min(100, Math.max(1, limit)),
        select: {
          id: true,
          prompt: true,
          resolution: true,
          ratio: true,
          model: true,
          provider: true,
          imageCount: true,
          status: true,
          costUsd: true,
          error: true,
          createdAt: true,
          images: true,
        },
      }),
      this.prisma.generation.count({ where: { userId } }),
    ]);
    return { total, rows };
  }

  async deleteHistoryEntry(userId: string, id: string) {
    const row = await this.prisma.generation.findFirst({
      where: { id, userId },
    });
    if (!row) return { removed: false };
    await this.prisma.generation.delete({ where: { id } });
    return { removed: true };
  }

  async generate(userId: string, dto: GenerateDto) {
    const prompt = dto.prompt.trim();
    if (prompt.length < 3) {
      throw new BadRequestException('Prompt must be at least 3 characters');
    }
    const maxImagesPerRun = await this.config.getNumber(
      'users.maxImagesPerRun',
      4,
    );
    if (dto.imageCount < 1 || dto.imageCount > maxImagesPerRun) {
      throw new BadRequestException(
        `imageCount must be between 1 and ${maxImagesPerRun}`,
      );
    }

    const user = await this.users.findById(userId);
    if (!user) throw new ForbiddenException('Account not found');
    if (user.banned) throw new ForbiddenException('Account banned');

    const tierRaw =
      dto.resolution ??
      (await this.config.getString('users.defaultResolution', 'medium'));
    const tier: ResolutionTier = isResolutionTier(tierRaw) ? tierRaw : 'medium';
    if (!(await this.config.isResolutionEnabled(tier))) {
      throw new ForbiddenException(
        `Resolution tier '${tier}' is disabled by the admin`,
      );
    }
    if (
      !(await this.config.isResolutionAllowedForUser(
        tier,
        user.role === 'ADMIN',
      ))
    ) {
      throw new ForbiddenException(
        `Resolution tier '${tier}' is not allowed for your account`,
      );
    }

    const usedToday = await this.usage.countToday(userId);
    if (usedToday + dto.imageCount > user.dailyQuota) {
      throw new HttpException(
        {
          message: 'Daily generation limit reached',
          code: 'QUOTA_EXCEEDED',
          usage: await this.usage.myUsage(userId, user.dailyQuota),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const enabledProviders = await this.providers.listEnabled();
    if (enabledProviders.length === 0) {
      throw new ServiceUnavailableException('No AI provider is enabled');
    }

    const baseSize = sizeFor(dto.ratio);
    const scale = await this.config.getResolutionScale(tier);
    const request: GenerationRequest = {
      prompt,
      negativePrompt: dto.negativePrompt,
      imageCount: dto.imageCount,
      size: {
        width: Math.max(64, Math.round((baseSize.width * scale) / 8) * 8),
        height: Math.max(64, Math.round((baseSize.height * scale) / 8) * 8),
      },
      seed: dto.seed,
      model: dto.model,
    };

    let lastError: unknown = null;
    for (const provider of enabledProviders) {
      try {
        const adapter = this.adapterFactory.forProvider(provider);
        const images: GenerationImage[] = await adapter.generate(
          provider,
          request,
        );
        await this.usage.record({
          userId,
          providerId: provider.id,
          prompt,
          imageCount: images.length,
          costUsd: images.length * adapter.costPerImage,
          status: 'success',
        });
        await this.prisma.generation.create({
          data: {
            userId,
            prompt,
            negativePrompt: dto.negativePrompt,
            resolution: tier,
            ratio: dto.ratio,
            model: request.model ?? null,
            provider: provider.name,
            sizeW: request.size.width,
            sizeH: request.size.height,
            imageCount: images.length,
            status: 'success',
            images: images.map((img) => img.b64),
            costUsd: images.length * adapter.costPerImage,
          },
        });
        return {
          provider: provider.name,
          model: request.model ?? null,
          prompt,
          usage: await this.usage.myUsage(userId, user.dailyQuota),
          images,
        };
      } catch (error) {
        lastError = error;
        await this.usage.record({
          userId,
          providerId: provider.id,
          prompt,
          imageCount: 0,
          costUsd: 0,
          status: 'error',
        });
      }
    }

    await this.prisma.generation.create({
      data: {
        userId,
        prompt,
        negativePrompt: dto.negativePrompt,
        resolution: tier,
        ratio: dto.ratio,
        model: request.model ?? null,
        provider: enabledProviders[0]?.name ?? 'unknown',
        sizeW: request.size.width,
        sizeH: request.size.height,
        imageCount: 0,
        status: 'error',
        images: [],
        costUsd: 0,
        error:
          lastError instanceof Error
            ? lastError.message.slice(0, 400)
            : 'All AI providers failed',
      },
    });

    const message =
      lastError instanceof Error
        ? lastError.message
        : 'All AI providers failed';
    this.logger.warn(`generation failed for user ${userId}: ${message}`);
    throw new ServiceUnavailableException(
      'Image generation failed — no provider could produce an image. Try again shortly.',
    );
  }
}
