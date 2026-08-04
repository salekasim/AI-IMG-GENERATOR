import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { ToolsModule } from '../tools/tools.module';
import { RegistryModule } from '../registry/registry.module';
import { UsersModule } from '../users/users.module';
import { CryptoService } from '../common/crypto.service';
import { ExecutionController } from './execution/execution.controller';
import { ExecutionEngine } from './execution/execution-engine.service';
import { ChatAdapter } from './execution/chat.adapter';
import { RoutingModule } from './execution/routing.module';
import { HealthService } from './health/health.service';
import { SseService } from './sse.service';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    ToolsModule,
    StorageModule,
    RoutingModule,
    RegistryModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1d' },
      }),
    }),
  ],
  controllers: [WorkflowController, ExecutionController],
  providers: [
    WorkflowService,
    ExecutionEngine,
    ChatAdapter,
    HealthService,
    SseService,
    CryptoService,
  ],
  exports: [ExecutionEngine, SseService],
})
export class OrchestratorModule {}
