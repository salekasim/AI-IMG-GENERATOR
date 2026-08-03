import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { CryptoService } from '../common/crypto.service';
import { FireworksAdapter } from '../generation/adapters/fireworks.adapter';
import { GeminiAdapter } from '../generation/adapters/gemini.adapter';
import { OpenAIAdapter } from '../generation/adapters/openai.adapter';
import { PollinationsAdapter } from '../generation/adapters/pollinations.adapter';
import { ProviderAdapterFactory } from '../generation/adapters/provider-adapter.factory';
import { ReplicateAdapter } from '../generation/adapters/replicate.adapter';
import { StabilityAdapter } from '../generation/adapters/stability.adapter';
import { TogetherAdapter } from '../generation/adapters/together.adapter';
import { ExecutionController } from './execution/execution.controller';
import { ExecutionEngine } from './execution/execution-engine.service';
import { ChatAdapter } from './execution/chat.adapter';
import { RoutingService } from './execution/routing.service';
import { RulesService } from './execution/rules.service';
import { HealthService } from './health/health.service';
import { SseService } from './sse.service';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'dev-secret',
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [WorkflowController, ExecutionController],
  providers: [
    WorkflowService,
    ExecutionEngine,
    ChatAdapter,
    RoutingService,
    RulesService,
    HealthService,
    SseService,
    CryptoService,
    ProviderAdapterFactory,
    OpenAIAdapter,
    PollinationsAdapter,
    StabilityAdapter,
    GeminiAdapter,
    TogetherAdapter,
    FireworksAdapter,
    ReplicateAdapter,
  ],
  exports: [ExecutionEngine, SseService],
})
export class OrchestratorModule {}
