import { Injectable } from '@nestjs/common';
import { AiProvider } from '@prisma/client';
import { FalAdapter } from './fal.adapter';
import { FireworksAdapter } from './fireworks.adapter';
import { GeminiAdapter } from './gemini.adapter';
import { GenericOpenAIAdapter } from './generic-openai.adapter';
import { OpenAIAdapter } from './openai.adapter';
import { PollinationsAdapter } from './pollinations.adapter';
import { ProviderAdapter } from './provider.adapter';
import { ReplicateAdapter } from './replicate.adapter';
import { StabilityAdapter } from './stability.adapter';
import { TogetherAdapter } from './together.adapter';

@Injectable()
export class ProviderAdapterFactory {
  constructor(
    private readonly pollinations: PollinationsAdapter,
    private readonly openai: OpenAIAdapter,
    private readonly stability: StabilityAdapter,
    private readonly gemini: GeminiAdapter,
    private readonly together: TogetherAdapter,
    private readonly fireworks: FireworksAdapter,
    private readonly replicate: ReplicateAdapter,
    private readonly fal: FalAdapter,
    private readonly custom: GenericOpenAIAdapter,
  ) {}

  forProvider(provider: AiProvider): ProviderAdapter {
    switch (provider.name) {
      case 'pollinations':
        return this.pollinations;
      case 'openai':
        return this.openai;
      case 'stability':
        return this.stability;
      case 'google':
        return this.gemini;
      case 'together':
        return this.together;
      case 'fireworks':
        return this.fireworks;
      case 'replicate':
        return this.replicate;
      case 'fal-image':
        return this.fal;
      default:
        // Custom providers (created from the builder) use the generic
        // OpenAI-compatible image contract.
        return this.custom;
    }
  }
}
