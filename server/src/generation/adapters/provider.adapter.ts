import { AiProvider } from '@prisma/client';
import { Size } from '../ratio';

export interface GenerationRequest {
  prompt: string;
  negativePrompt?: string;
  imageCount: number;
  size: Size;
  seed?: number;
  model?: string;
}

export interface GenerationImage {
  /** Base64-encoded PNG/JPEG bytes, as returned by the provider. */
  b64: string;
  width: number;
  height: number;
}

export interface ProviderAdapter {
  readonly providerName: string;
  /** Estimated cost in USD per generated image. */
  readonly costPerImage: number;
  generate(
    provider: AiProvider,
    request: GenerationRequest,
  ): Promise<GenerationImage[]>;
}
