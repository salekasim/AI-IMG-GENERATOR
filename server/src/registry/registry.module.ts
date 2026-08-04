import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RegistryController } from './registry.controller';
import { RegistryService } from './registry.service';

@Module({
  imports: [PrismaModule],
  controllers: [RegistryController],
  providers: [RegistryService],
  exports: [RegistryService],
})
export class RegistryModule {}
