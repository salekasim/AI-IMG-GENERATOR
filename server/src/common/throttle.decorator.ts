import { SetMetadata } from '@nestjs/common';

export const THROTTLE_META = 'throttle';

export interface ThrottleOptions {
  /** Maximum requests allowed in the window. */
  limit: number;
  /** Window duration in milliseconds. */
  windowMs: number;
  /** What to key the bucket on. */
  key: 'ip' | 'user';
}

/** Apply a per-route rate limit. Omit to leave the route unlimited. */
export const Throttle = (options: ThrottleOptions) =>
  SetMetadata(THROTTLE_META, options);
