import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuditRetentionService } from './audit-retention.service';
import { AuditService } from './audit.service';
import { SettingsService } from './settings.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AuditService,
    SettingsService,
    AuditRetentionService,
  ],
})
export class AdminModule {}
