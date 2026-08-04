import { Controller, Get, Post } from '@nestjs/common';
import { RegistryService } from './registry.service';

/**
 * Dynamic node library + capability sync. Consumed by the admin Node Library
 * so new node types / capabilities / providers appear without redeploys.
 */
@Controller('admin')
export class RegistryController {
  constructor(private readonly registry: RegistryService) {}

  @Get('nodes')
  listNodes() {
    return this.registry.listNodes();
  }

  @Post('nodes/sync-model-capabilities')
  syncModelCapabilities() {
    return this.registry.syncModelCapabilities();
  }
}
