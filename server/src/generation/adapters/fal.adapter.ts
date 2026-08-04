import { Injectable, Logger } from '@nestjs/common';
import { AiProvider } from '@prisma/client';
import { CryptoService } from '../../common/crypto.service';
import {
  GenerationImage,
  GenerationRequest,
  ProviderAdapter,
} from './provider.adapter';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fal.ai image generation (flux-pro / flux-dev / flux-kontext …).
 * Uses the queue flow: POST {base}/{model} → poll {base}/requests/{id}/status
 * → fetch {base}/requests/{id} for the completed result, mirroring the
 * fal-style branch of VideoAdapter.
 */
@Injectable()
export class FalAdapter implements ProviderAdapter {
  readonly providerName = 'fal-image';
  readonly costPerImage = 0.03;

  private readonly logger = new Logger(FalAdapter.name);

  constructor(private readonly crypto: CryptoService) {}

  async generate(
    provider: AiProvider,
    request: GenerationRequest,
  ): Promise<GenerationImage[]> {
    if (!provider.apiKeyEnc) {
      throw new Error(
        `Image provider '${provider.name}' has no API key — add it in Admin → Providers`,
      );
    }
    const apiKey = this.crypto.decrypt(provider.apiKeyEnc);
    const model = request.model?.trim();
    if (!model) {
      throw new Error('fal image chain step has no model');
    }

    const base = provider.baseUrl.replace(/\/+$/, '');
    // fal queue API: POST {base}/fal-ai/{endpoint}/run
    const submitUrl = provider.name.startsWith('fal')
      ? `${base}/fal-ai/${model}/run`
      : `${base}/${model}`;
    const body: Record<string, unknown> = {
      prompt: request.prompt,
      num_images: request.imageCount,
      image_size: {
        width: request.size.width,
        height: request.size.height,
      },
    };
    if (request.negativePrompt) body.negative_prompt = request.negativePrompt;
    if (request.seed !== undefined) body.seed = request.seed;

    const submitRes = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(provider.timeoutMs || 120000),
    });
    if (!submitRes.ok) {
      const detail = (await submitRes.text().catch(() => '')).slice(0, 300);
      throw new Error(
        `fal ${model} submit failed (${submitRes.status}): ${detail}`,
      );
    }
    const submitted = (await submitRes.json()) as {
      request_id?: string;
      id?: string;
      url?: string;
    };
    const requestId = submitted.request_id ?? submitted.id;
    if (!requestId) {
      throw new Error(
        `fal ${model} returned no request id: ${JSON.stringify(submitted).slice(0, 200)}`,
      );
    }

    const queueBase = submitted.url ?? `${base.replace('/run', '/queue')}`;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 300_000) {
      await sleep(3000);
      const statusRes = await fetch(
        `${queueBase}/requests/${requestId}/status`,
        {
          headers: { Authorization: `Key ${apiKey}` },
          signal: AbortSignal.timeout(60000),
        },
      );
      if (!statusRes.ok) continue;
      const status = (await statusRes.json()) as { status?: string; error?: string };
      if (status.status === 'COMPLETED') {
        const resultRes = await fetch(`${queueBase}/requests/${requestId}`, {
          headers: { Authorization: `Key ${apiKey}` },
          signal: AbortSignal.timeout(60000),
        });
        if (!resultRes.ok) {
          throw new Error(`fal ${model} result fetch failed (${resultRes.status})`);
        }
        const result = (await resultRes.json()) as {
          images?: Array<{ url: string; width: number; height: number }>;
        };
        const images = result.images;
        if (!Array.isArray(images) || !images.length) {
          throw new Error(
            `fal ${model} completed but no images: ${JSON.stringify(result).slice(0, 300)}`,
          );
        }
        const output: GenerationImage[] = [];
        for (const image of images) {
          if (!image?.url) continue;
          const download = await fetch(image.url, {
            signal: AbortSignal.timeout(60000),
          });
          if (!download.ok) continue;
          const buffer = Buffer.from(await download.arrayBuffer());
          output.push({
            b64: buffer.toString('base64'),
            width: image.width ?? request.size.width,
            height: image.height ?? request.size.height,
          });
        }
        if (!output.length) {
          throw new Error(`fal ${model} images failed to download`);
        }
        return output;
      }
      if (status.status === 'FAILED' || status.status === 'ERROR') {
        throw new Error(`fal ${model} failed: ${status.error ?? status.status}`);
      }
    }
    throw new Error(`fal ${model} timed out after 5 minutes`);
  }
}
