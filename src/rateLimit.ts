// rateLimit.ts — Instance-scoped rate limiter. No global mutable state.
// Keyed by tier — free and pro calls have independent sliding windows.

import { PLAN_LIMITS } from './types.js';
import type { RateLimiter } from './types.js';

export class LocalRateLimiter implements RateLimiter {
  // Keyed by tier — prevents free/pro calls from crowding each other's window
  private timestampsByTier: Record<string, number[]> = {};

  check(tier: string): { allowed: boolean; retry_after_seconds?: number } {
    const limit = PLAN_LIMITS[tier]?.rate_per_minute ?? 5;
    const windowMs = 60_000; // 1-minute sliding window
    const now = Date.now();

    if (!this.timestampsByTier[tier]) this.timestampsByTier[tier] = [];
    const timestamps = this.timestampsByTier[tier];

    // Remove timestamps outside the window
    while (timestamps.length > 0 && timestamps[0] < now - windowMs) {
      timestamps.shift();
    }

    if (timestamps.length >= limit) {
      const oldestInWindow = timestamps[0];
      const retry_after_seconds = Math.ceil((oldestInWindow + windowMs - now) / 1000);
      return { allowed: false, retry_after_seconds };
    }

    timestamps.push(now);
    return { allowed: true };
  }
}
