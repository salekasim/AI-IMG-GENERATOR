import { Injectable } from '@nestjs/common';
import { AiProvider } from '@prisma/client';
import { GenerationImage, GenerationRequest, ProviderAdapter } from './provider.adapter';

@Injectable()
export class PollinationsAdapter implements ProviderAdapter {
  readonly providerName = 'pollinations';
  readonly costPerImage = 0;

  async generate(
    provider: AiProvider,
    request: GenerationRequest,
  ): Promise<GenerationImage[]> {
    const model = request.model ?? 'flux';
    const images: GenerationImage[] = [];
    for (let i = 0; i < request.imageCount; i++) {
      const seed = (request.seed ?? 0) + i;
      const url = new URL(
        `/prompt/${encodeURIComponent(request.prompt)}`,
        provider.baseUrl,
      );
      url.searchParams.set('width', String(request.size.width));
      url.searchParams.set('height', String(request.size.height));
      url.searchParams.set('seed', String(seed));
      url.searchParams.set('model', model);
      url.searchParams.set('nologo', 'true');
      url.searchParams.set('enhance', 'false');

      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(provider.timeoutMs || 90000),
      });
      if (!response.ok) {
        throw new Error(
          `Pollinations ${model} failed with ${response.status}: ${await response.text().catch(() => '')}`.trim(),
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
