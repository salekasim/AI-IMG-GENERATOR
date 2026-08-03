import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CryptoService } from './crypto.service';
import { PlatformConfigService } from './platform-config.service';
import { RateLimitService } from './rate-limit.service';
import { ThrottleGuard } from './throttle.guard';

@Global()
@Module({
  providers: [
    CryptoService,
    PlatformConfigService,
    RateLimitService,
    { provide: APP_GUARD, useClass: ThrottleGuard },
  ],
  exports: [CryptoService, PlatformConfigService, RateLimitService],
})
export class CommonModule {}
