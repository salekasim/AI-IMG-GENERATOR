import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitService } from './rate-limit.service';
import { THROTTLE_META, ThrottleOptions } from './throttle.decorator';

@Injectable()
export class ThrottleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimit: RateLimitService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.get<ThrottleOptions>(
      THROTTLE_META,
      context.getHandler(),
    );
    if (!options) return true;

    const request = context.switchToHttp().getRequest();
    const identity =
      options.key === 'user'
        ? `u:${request.user?.userId ?? request.user?.id ?? 'anon'}`
        : `ip:${request.ip ?? request.socket?.remoteAddress ?? '?'}`;

    const result = this.rateLimit.consume(identity, options.limit, options.windowMs);
    if (!result.allowed) {
      context
        .switchToHttp()
        .getResponse()
        .setHeader('retry-after', String(result.retryAfterSec));
      throw new HttpException(
        'Too many requests — please slow down and try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
