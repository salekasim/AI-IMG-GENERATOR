import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FalAdapter } from '../../generation/adapters/fal.adapter';
import { FireworksAdapter } from '../../generation/adapters/fireworks.adapter';
import { GeminiAdapter } from '../../generation/adapters/gemini.adapter';
import { GenericOpenAIAdapter } from '../../generation/adapters/generic-openai.adapter';
import { OpenAIAdapter } from '../../generation/adapters/openai.adapter';
import { PollinationsAdapter } from '../../generation/adapters/pollinations.adapter';
import { ProviderAdapterFactory } from '../../generation/adapters/provider-adapter.factory';
import { ReplicateAdapter } from '../../generation/adapters/replicate.adapter';
import { StabilityAdapter } from '../../generation/adapters/stability.adapter';
import { TogetherAdapter } from '../../generation/adapters/together.adapter';
import { RoutingService } from './routing.service';
import { RulesService } from './rules.service';

/**
 * Shared provider-routing layer (adapters + failover rules), consumed by both
 * the execution engine and the tool runner without a circular module graph.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    ProviderAdapterFactory,
    OpenAIAdapter,
    PollinationsAdapter,
    StabilityAdapter,
    GeminiAdapter,
    TogetherAdapter,
    FireworksAdapter,
    ReplicateAdapter,
    FalAdapter,
    GenericOpenAIAdapter,
    RulesService,
    RoutingService,
  ],
  exports: [RoutingService, RulesService, ProviderAdapterFactory],
})
export class RoutingModule {}
