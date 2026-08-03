import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { OrchestratorModule } from '../orchestrator/workflow.module';
import { ClientController } from './client.controller';
import { ClientService } from './client.service';

@Module({
  imports: [
    PrismaModule,
    OrchestratorModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '2h' },
      }),
    }),
  ],
  controllers: [ClientController],
  providers: [ClientService],
})
export class ClientModule {}
