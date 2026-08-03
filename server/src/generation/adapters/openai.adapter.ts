import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AiProvider } from '@prisma/client';
import {
  GenerationImage,
  GenerationRequest,
  ProviderAdapter,
} from './provider.adapter';
import { CryptoService } from '../../common/crypto.service';

@Injectable()
export class OpenAIAdapter implements ProviderAdapter {
  readonly providerName = 'openai';
  readonly costPerImage = 0.04;

  constructor(private readonly crypto: CryptoService) {}

  async generate(
    provider: AiProvider,
    request: GenerationRequest,
  ): Promise<GenerationImage[]> {
    const apiKey = provider.apiKeyEnc
      ? this.crypto.decrypt(provider.apiKeyEnc)
      : null;
    if (!apiKey) {
      throw new ServiceUnavailableException('OpenAI API key is not configured');
    }
    const model = request.model ?? 'gpt-image-1';
    const ratio = `${request.size.width}x${request.size.height}`;
    const size =
      ratio === '1280x720'
        ? '1536x1024'
        : ratio === '720x1280'
          ? '1024x1536'
          : '1024x1024';

    const response = await fetch(`${provider.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt: request.prompt,
        n: request.imageCount,
        size,
        response_format: 'b64_json',
      }),
      signal: AbortSignal.timeout(provider.timeoutMs || 120000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `OpenAI failed with ${response.status}: ${detail}`.slice(0, 500),
      );
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
