import { Injectable } from '@nestjs/common';
import { AiProvider } from '@prisma/client';
import { CryptoService } from '../../common/crypto.service';
import {
  GenerationImage,
  GenerationRequest,
  ProviderAdapter,
} from './provider.adapter';

/**
 * Generic OpenAI-compatible image adapter for custom providers.
 * POSTs { model, prompt, n, width, height } to baseUrl + imageEndpoint
 * (default '/images/generations') and accepts b64_json or url responses —
 * the same contract as Together / Groq image APIs.
 */
@Injectable()
export class GenericOpenAIAdapter implements ProviderAdapter {
  readonly providerName = '__custom__';
  readonly costPerImage = 0;

  constructor(private readonly crypto: CryptoService) {}

  async generate(
    provider: AiProvider,
    request: GenerationRequest,
  ): Promise<GenerationImage[]> {
    const apiKey = provider.apiKeyEnc
      ? this.crypto.decrypt(provider.apiKeyEnc)
      : null;
    const endpoint =
      provider.imageEndpoint && !provider.imageEndpoint.includes('{')
        ? provider.imageEndpoint
        : '/images/generations';

    const response = await fetch(
      `${provider.baseUrl.replace(/\/+$/, '')}${endpoint}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          n: request.imageCount,
          width: request.size.width,
          height: request.size.height,
          ...(request.negativePrompt
            ? { negative_prompt: request.negativePrompt }
            : {}),
          ...(request.seed !== undefined ? { seed: request.seed } : {}),
        }),
        signal: AbortSignal.timeout(provider.timeoutMs || 120000),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `${provider.displayName} ${request.model ?? ''} failed with ${response.status}: ${detail}`.slice(
          0,
          500,
        ),
      );
    }
    const data = (await response.json()) as {
      data: Array<{ b64_json?: string; url?: string }>;
    };
    if (!Array.isArray(data.data) || !data.data.length) {
      throw new Error(`${provider.displayName} returned no images in response`);
    }

    const images: GenerationImage[] = [];
    for (const item of data.data) {
      if (typeof item.b64_json === 'string' && item.b64_json) {
        images.push({
          b64: item.b64_json,
          width: request.size.width,
          height: request.size.height,
        });
      } else if (typeof item.url === 'string' && item.url) {
        const fetched = await fetch(item.url, {
          signal: AbortSignal.timeout(60_000),
        });
        if (!fetched.ok) {
          throw new Error(
            `Failed to download image from ${item.url} (${fetched.status})`,
          );
        }
        const buffer = Buffer.from(await fetched.arrayBuffer());
        images.push({
          b64: buffer.toString('base64'),
          width: request.size.width,
          height: request.size.height,
        });
      }
    }
    if (!images.length) {
      throw new Error(
        `${provider.displayName} returned images without b64/url payloads`,
      );
    }
    return images;
  }
}
