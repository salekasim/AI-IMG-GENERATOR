import { Injectable } from '@nestjs/common';
import { AiProvider } from '@prisma/client';
import { GenerationImage, GenerationRequest, ProviderAdapter } from './provider.adapter';
import { CryptoService } from '../../common/crypto.service';

/** Google Gemini Imagen — REST predict API. */
@Injectable()
export class GeminiAdapter implements ProviderAdapter {
  readonly providerName = 'google';
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
      throw new Error('Gemini API key is not configured');
    }
    const model = request.model ?? 'imagen-3.0-generate-002';
    const ratio = this.aspectRatio(request.size.width, request.size.height);
    const body: Record<string, unknown> = {
      instances: [{ prompt: request.prompt }],
      parameters: {
        sampleCount: request.imageCount,
        aspectRatio: ratio,
      },
    };
    if (request.negativePrompt) {
      (body.parameters as Record<string, unknown>).negativePrompt = request.negativePrompt;
    }

    const base = provider.baseUrl.replace(/\/+$/, '');
    const url = `${base}/models/${encodeURIComponent(model)}:predict?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(provider.timeoutMs || 120000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Gemini ${model} failed with ${response.status}: ${detail}`.slice(0, 500));
    }
    const data = (await response.json()) as {
      predictions?: Array<{ bytesBase64Encoded: string }>;
    };
    const images = (data.predictions ?? []).map((p) => ({
      b64: p.bytesBase64Encoded,
      width: request.size.width,
      height: request.size.height,
    }));
    if (!images.length) {
      throw new Error(`Gemini ${model} returned no images`);
    }
    return images;
  }

  private aspectRatio(width: number, height: number): string {
    const ratio = width / height;
    if (ratio > 1.7) return '16:9';
    if (ratio < 0.6) return '9:16';
    if (ratio > 1.2) return '3:2';
    if (ratio < 0.85) return '2:3';
    return '1:1';
  }
}
