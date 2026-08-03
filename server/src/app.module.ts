import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import dns from 'dns';

// Pollinations (free tier) returns HTTP 402 on IPv6 egress — prefer IPv4 for all
// outbound provider calls so anonymous usage stays on the IPv4 quota.
dns.setDefaultResultOrder('ipv4first');
import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { ClientModule } from './client/client.module';
import { CommonModule } from './common/common.module';
import { GenerationModule } from './generation/generation.module';
import { OrchestratorModule } from './orchestrator/workflow.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { ProvidersModule } from './providers/providers.module';
import { UsageModule } from './usage/usage.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CommonModule,
    PrismaModule,
    UsersModule,
    AuthModule,
    ProvidersModule,
    UsageModule,
    GenerationModule,
    AdminModule,
    OrchestratorModule,
    ProjectsModule,
    ClientModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
