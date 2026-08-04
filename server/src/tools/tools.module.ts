import { Module } from '@nestjs/common';
import { RoutingModule } from '../orchestrator/execution/routing.module';
import { StorageModule } from '../storage/storage.module';
import { ChatAdapter } from '../orchestrator/execution/chat.adapter';
import { ToolRunnerService } from './tool-runner.service';
import { ToolsController } from './tools.controller';
import { ToolsService } from './tools.service';
import { VideoAdapter } from './video.adapter';

@Module({
  imports: [StorageModule, RoutingModule],
  controllers: [ToolsController],
  providers: [ToolsService, ToolRunnerService, VideoAdapter, ChatAdapter],
  exports: [ToolsService, ToolRunnerService],
})
export class ToolsModule {}
