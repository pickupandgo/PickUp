import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Principal } from '../../auth/principal';

/**
 * Rate limits per authenticated user when known, otherwise per client IP.
 * Runs after AuthGuard so the principal is already resolved.
 *
 * Storage is in-memory, which is correct for a single instance. Before running more than one
 * instance, switch to a shared store (Redis) so limits apply across instances.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(request: Record<string, unknown>): Promise<string> {
    const principal = request['principal'] as Principal | undefined;
    if (principal) {
      return Promise.resolve(`user:${principal.userId}`);
    }
    const ip = typeof request['ip'] === 'string' ? request['ip'] : 'unknown';
    return Promise.resolve(`ip:${ip}`);
  }
}
