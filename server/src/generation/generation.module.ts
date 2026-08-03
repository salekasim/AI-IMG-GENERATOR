import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { UsageModule } from '../usage/usage.module';
import { UsersModule } from '../users/users.module';
import { FireworksAdapter } from './adapters/fireworks.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { OpenAIAdapter } from './adapters/openai.adapter';
import { PollinationsAdapter } from './adapters/pollinations.adapter';
import { ProviderAdapterFactory } from './adapters/provider-adapter.factory';
import { ReplicateAdapter } from './adapters/replicate.adapter';
import { StabilityAdapter } from './adapters/stability.adapter';
import { TogetherAdapter } from './adapters/together.adapter';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';

@Module({
  imports: [ProvidersModule, UsageModule, UsersModule],
  controllers: [GenerationController],
  providers: [
    GenerationService,
    ProviderAdapterFactory,
    PollinationsAdapter,
    OpenAIAdapter,
    StabilityAdapter,
    GeminiAdapter,
    TogetherAdapter,
    FireworksAdapter,
    ReplicateAdapter,
  ],
})
export class GenerationModule {}
