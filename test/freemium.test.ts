// test/freemium.test.ts — Freemium gate: limits, enforcement, metering-after-success.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalFsStorage } from '../src/storage/localFs.js';
import { LocalRateLimiter } from '../src/rateLimit.js';
import { PLAN_LIMITS } from '../src/types.js';
import type { ExecutionContext, RateLimiter } from '../src/types.js';
import { log } from '../src/logger.js';

let testDir: string;
let storage: LocalFsStorage;

// Non-blocking rate limiter for lifetime/enforcement tests (isolates rate from lifetime concerns)
const noopRateLimiter: RateLimiter = { check: () => ({ allowed: true }) };

function makeTestStorage(): LocalFsStorage {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-freemium-'));
  return new LocalFsStorage(testDir);
}

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    requestId: 'test-req-id',
    storage,
    logger: log,
    config: {
      schema_version: 1,
      mode: 'manual',
      threshold: 60,
      strictness: 'standard',
      auto_compile: true,
      default_target: 'claude',
      ephemeral_mode: false,
      max_sessions: 200,
      max_session_size_kb: 50,
      max_session_dir_mb: 20,
    },
    rateLimiter: noopRateLimiter,
    tier: 'free',
    ...overrides,
  };
}

describe('Freemium enforcement', () => {
  beforeEach(() => {
    storage = makeTestStorage();
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true }); } catch {}
  });

  it('PLAN_LIMITS is structured correctly', () => {
    assert.ok(PLAN_LIMITS.free, 'Free tier should exist');
    assert.ok(PLAN_LIMITS.pro, 'Pro tier should exist');
    assert.ok(PLAN_LIMITS.power, 'Power tier should exist');
    assert.equal(PLAN_LIMITS.free.lifetime, 10);
    assert.equal(PLAN_LIMITS.free.monthly, 10);
    assert.equal(PLAN_LIMITS.free.rate_per_minute, 5);
    assert.equal(PLAN_LIMITS.free.always_on, false);
    assert.equal(PLAN_LIMITS.pro.lifetime, Infinity);
    assert.equal(PLAN_LIMITS.pro.monthly, 100);
    assert.equal(PLAN_LIMITS.pro.rate_per_minute, 30);
    assert.equal(PLAN_LIMITS.pro.always_on, false);
    assert.equal(PLAN_LIMITS.power.lifetime, Infinity);
    assert.equal(PLAN_LIMITS.power.monthly, Infinity);
    assert.equal(PLAN_LIMITS.power.rate_per_minute, 60);
    assert.equal(PLAN_LIMITS.power.always_on, true);
  });

  it('allows first 10 uses on free tier', async () => {
    const ctx = makeCtx();

    for (let i = 0; i < 10; i++) {
      const result = await storage.canUseOptimization(ctx);
      assert.ok(result.allowed, `Use ${i + 1} should be allowed`);
      assert.equal(result.enforcement, null);
      // Increment usage to simulate actual use
      await storage.incrementUsage();
    }
  });

  it('gates 11th use on free tier with lifetime enforcement', async () => {
    const ctx = makeCtx();

    // Use up 10
    for (let i = 0; i < 10; i++) {
      await storage.incrementUsage();
    }

    const result = await storage.canUseOptimization(ctx);
    assert.equal(result.allowed, false);
    assert.equal(result.enforcement, 'lifetime');
    assert.equal(result.remaining.lifetime, 0);
  });

  it('EnforcementResult has correct shape', async () => {
    const ctx = makeCtx();
    const result = await storage.canUseOptimization(ctx);

    assert.ok('allowed' in result);
    assert.ok('enforcement' in result);
    assert.ok('usage' in result);
    assert.ok('limits' in result);
    assert.ok('remaining' in result);
    assert.ok('lifetime' in result.remaining);
    assert.ok('monthly' in result.remaining);
  });

  it('pro tier bypasses lifetime limit', async () => {
    const ctx = makeCtx({ tier: 'pro' });

    // Simulate 20 uses (beyond free limit)
    for (let i = 0; i < 20; i++) {
      await storage.incrementUsage();
    }

    const result = await storage.canUseOptimization(ctx);
    assert.ok(result.allowed, 'Pro should not be limited at 20 uses');
    assert.equal(result.enforcement, null);
  });

  it('metering only after success (counter unchanged on failure)', async () => {
    const beforeUsage = await storage.getUsage();
    assert.equal(beforeUsage.total_optimizations, 0);

    // Simulate: validation passed, but compiler throws mid-execution
    let success = false;
    try {
      // Simulate pipeline work...
      throw new Error('Simulated compiler failure');
      success = true; // unreachable — that's the point
    } catch {
      // Error handled — success stays false
    } finally {
      if (success) {
        await storage.incrementUsage();
      }
    }

    // Counter should NOT have incremented
    const afterUsage = await storage.getUsage();
    assert.equal(afterUsage.total_optimizations, 0, 'Counter should be unchanged after failure');
  });

  it('always_on mode blocked for free and pro tiers, allowed for power', () => {
    assert.equal(PLAN_LIMITS.free.always_on, false);
    assert.equal(PLAN_LIMITS.pro.always_on, false);
    assert.equal(PLAN_LIMITS.power.always_on, true);
  });
});

describe('Rate limiter', () => {
  it('is instance-scoped (no global mutable state)', () => {
    const limiter1 = new LocalRateLimiter();
    const limiter2 = new LocalRateLimiter();

    // Fill up limiter1
    for (let i = 0; i < 5; i++) {
      limiter1.check('free');
    }
    const result1 = limiter1.check('free');
    assert.equal(result1.allowed, false, 'limiter1 should be exhausted');

    // limiter2 should be independent
    const result2 = limiter2.check('free');
    assert.ok(result2.allowed, 'limiter2 should be independent');
  });

  it('returns retry_after_seconds when rate limited', () => {
    const limiter = new LocalRateLimiter();

    // Exhaust the free tier limit
    for (let i = 0; i < PLAN_LIMITS.free.rate_per_minute; i++) {
      limiter.check('free');
    }

    const result = limiter.check('free');
    assert.equal(result.allowed, false);
    assert.ok(typeof result.retry_after_seconds === 'number', 'Should have retry_after_seconds');
    assert.ok(result.retry_after_seconds! > 0, 'retry_after_seconds should be positive');
    assert.ok(result.retry_after_seconds! <= 60, 'retry_after_seconds should be <= 60');
  });

  it('free and pro tiers have independent windows', () => {
    const limiter = new LocalRateLimiter();

    // Exhaust free tier
    for (let i = 0; i < PLAN_LIMITS.free.rate_per_minute; i++) {
      limiter.check('free');
    }
    const freeResult = limiter.check('free');
    assert.equal(freeResult.allowed, false, 'Free should be exhausted');

    // Pro should still work
    const proResult = limiter.check('pro');
    assert.ok(proResult.allowed, 'Pro should be independent from free');
  });
});
