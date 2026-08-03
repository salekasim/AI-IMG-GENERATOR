import { Injectable } from '@nestjs/common';
import { AiProvider } from '@prisma/client';
import { GenerationImage, GenerationRequest, ProviderAdapter } from './provider.adapter';
import { CryptoService } from '../../common/crypto.service';

/** Fireworks AI images API (OpenAI-compatible, e.g. FLUX.1). */
@Injectable()
export class FireworksAdapter implements ProviderAdapter {
  readonly providerName = 'fireworks';
  readonly costPerImage = 0.003;

  constructor(private readonly crypto: CryptoService) {}

  async generate(
    provider: AiProvider,
    request: GenerationRequest,
  ): Promise<GenerationImage[]> {
    const apiKey = provider.apiKeyEnc
      ? this.crypto.decrypt(provider.apiKeyEnc)
      : null;
    if (!apiKey) {
      throw new Error('Fireworks API key is not configured');
    }
    const model = request.model ?? 'accounts/fireworks/models/flux-1-schnell-fp8';

    const response = await fetch(
      `${provider.baseUrl.replace(/\/+$/, '')}/images/generations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          prompt: request.prompt,
          n: request.imageCount,
          width: request.size.width,
          height: request.size.height,
        }),
        signal: AbortSignal.timeout(provider.timeoutMs || 120000),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Fireworks ${model} failed with ${response.status}: ${detail}`.slice(0, 500));
    }
    const data = (await response.json()) as {
      data: Array<{ b64_json: string }>;
    };
    return data.data.map((item) => ({
      b64: item.b64_json,
      width: request.size.width,
      height: request.size.height,
    }));
  }
}
