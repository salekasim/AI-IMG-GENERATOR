import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AiProvider } from '@prisma/client';
import {
  GenerationImage,
  GenerationRequest,
  ProviderAdapter,
} from './provider.adapter';
import { CryptoService } from '../../common/crypto.service';

@Injectable()
export class StabilityAdapter implements ProviderAdapter {
  readonly providerName = 'stability';
  readonly costPerImage = 0.03;

  constructor(private readonly crypto: CryptoService) {}

  async generate(
    provider: AiProvider,
    request: GenerationRequest,
  ): Promise<GenerationImage[]> {
    const apiKey = provider.apiKeyEnc
      ? this.crypto.decrypt(provider.apiKeyEnc)
      : null;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Stability API key is not configured',
      );
    }
    const images: GenerationImage[] = [];
    for (let i = 0; i < request.imageCount; i++) {
      const form = new FormData();
      form.append('prompt', request.prompt);
      if (request.negativePrompt) {
        form.append('negative_prompt', request.negativePrompt);
      }
      form.append('output_format', 'png');
      form.append('aspect_ratio', '1:1');
      const seed = request.seed ? String(request.seed + i) : undefined;
      if (seed) form.append('seed', seed);

      const response = await fetch(
        `${provider.baseUrl}/v2beta/stable-image/generate/core`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
          signal: AbortSignal.timeout(provider.timeoutMs || 120000),
        },
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(
          `Stability failed with ${response.status}: ${detail}`.slice(0, 500),
        );
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      images.push({
        b64: buffer.toString('base64'),
        width: request.size.width,
        height: request.size.height,
      });
    }
    return images;
  }
}
