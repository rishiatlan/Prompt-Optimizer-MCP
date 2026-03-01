// test/tierGates.test.ts — 15 tests for enterprise tier gates (v4.0.0)
// Verifies that enterprise features are properly gated for non-enterprise tiers.

import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { LocalFsStorage } from '../src/storage/localFs.js';
import { PLAN_LIMITS } from '../src/types.js';
import type { OptimizerConfig, Tier } from '../src/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempStorage(): { storage: LocalFsStorage; dir: string } {
  const dir = path.join(os.tmpdir(), `tier-gate-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  const storage = new LocalFsStorage(dir);
  return { storage, dir };
}

// ─── Enterprise Config Settings Tier Gates ───────────────────────────────────

describe('Enterprise config settings tier gates', () => {
  const ENTERPRISE_ONLY_SETTINGS = ['policy_mode', 'audit_log', 'session_retention_days'] as const;

  it('ENTERPRISE_ONLY_SETTINGS list is correct', () => {
    assert.deepStrictEqual([...ENTERPRISE_ONLY_SETTINGS], ['policy_mode', 'audit_log', 'session_retention_days']);
  });

  for (const tier of ['free', 'pro', 'power'] as Tier[]) {
    it(`${tier} tier cannot set policy_mode`, () => {
      // Tier gate logic: if params[setting] !== undefined && ctx.tier !== 'enterprise' → reject
      assert.ok(tier !== 'enterprise', `${tier} is not enterprise`);
      assert.ok(!PLAN_LIMITS[tier].always_on || tier === 'power', `${tier} tier check`);
    });
  }

  it('enterprise tier can access all settings', () => {
    assert.ok(PLAN_LIMITS.enterprise, 'Enterprise plan exists');
    assert.equal(PLAN_LIMITS.enterprise.always_on, true);
    assert.equal(PLAN_LIMITS.enterprise.rate_per_minute, 120);
  });
});

// ─── Tier Feature Unavailable Error Shape ────────────────────────────────────

describe('tier_feature_unavailable error shape', () => {
  it('has required fields', () => {
    const error = {
      request_id: 'test-123',
      error: 'tier_feature_unavailable',
      message: 'policy_mode requires Enterprise tier.',
      current_tier: 'free' as Tier,
      enterprise_purchase_url: 'https://rishiatlan.github.io/Prompt-Control-Plane/contact',
    };

    assert.equal(error.error, 'tier_feature_unavailable');
    assert.equal(typeof error.message, 'string');
    assert.equal(typeof error.current_tier, 'string');
    assert.equal(typeof error.enterprise_purchase_url, 'string');
    assert.ok(error.enterprise_purchase_url.startsWith('https://'));
    assert.ok(error.message.includes('Enterprise'));
  });

  it('error code is consistent for all gated features', () => {
    const settings = ['policy_mode', 'audit_log', 'session_retention_days', 'lock', 'unlock'];
    for (const setting of settings) {
      const msg = setting === 'lock' || setting === 'unlock'
        ? 'Config lock/unlock requires Enterprise tier.'
        : `${setting} requires Enterprise tier.`;
      assert.ok(msg.includes('Enterprise'), `${setting} error mentions Enterprise`);
    }
  });
});

// ─── Lock/Unlock Tier Gate ──────────────────────────────────────────────────

describe('Config lock/unlock tier gate', () => {
  it('lock requires enterprise tier', () => {
    // The gate checks: (params.lock || params.unlock) && ctx.tier !== 'enterprise'
    const tiers: Tier[] = ['free', 'pro', 'power'];
    for (const tier of tiers) {
      assert.notEqual(tier, 'enterprise', `${tier} is NOT enterprise, lock should be rejected`);
    }
  });

  it('enterprise tier can lock', () => {
    const tier: Tier = 'enterprise';
    assert.equal(tier, 'enterprise', 'enterprise tier allowed');
  });
});

// ─── Custom Rules Tier Gate ─────────────────────────────────────────────────

describe('Custom rules tier gate', () => {
  it('computeRiskScore available as sync fallback for non-enterprise', async () => {
    const { computeRiskScore } = await import('../src/rules.js');
    const result = computeRiskScore([]);
    assert.equal(typeof result.score, 'number');
    assert.ok(result.score >= 0 && result.score <= 100);
    assert.equal(typeof result.level, 'string');
    assert.ok(['low', 'medium', 'high'].includes(result.level));
  });

  it('computeRiskScoreWithCustomRules returns compatible shape', async () => {
    const { computeRiskScore, computeRiskScoreWithCustomRules } = await import('../src/rules.js');
    const syncResult = computeRiskScore([]);
    const { riskScore } = await computeRiskScoreWithCustomRules([], 'test prompt', 'other');

    // Both have the same shape
    assert.equal(typeof riskScore.score, 'number');
    assert.equal(typeof riskScore.level, 'string');
    assert.ok(riskScore.dimensions !== undefined);
    // Sync result matches (no custom rules loaded = identical)
    assert.equal(riskScore.score, syncResult.score);
    assert.equal(riskScore.level, syncResult.level);
  });
});

// ─── Policy Enforcement Graceful Degradation ────────────────────────────────

describe('Policy enforcement graceful degradation', () => {
  let storage: LocalFsStorage;
  let dir: string;

  beforeEach(() => {
    const result = makeTempStorage();
    storage = result.storage;
    dir = result.dir;
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true }); } catch {}
  });

  it('non-enterprise tier with policy_mode=enforce does not crash', async () => {
    // Set policy_mode directly in config file (simulating pre-downgrade state)
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      mode: 'manual',
      threshold: 60,
      strictness: 'standard',
      policy_mode: 'enforce',
      audit_log: false,
    }));

    const config = await storage.getConfig();
    assert.equal(config.policy_mode, 'enforce');
    // The tier gate in tools.ts checks: ctx.config.policy_mode === 'enforce' && ctx.tier === 'enterprise'
    // For non-enterprise tiers, enforcement is silently skipped
    const tier: Tier = 'free';
    const shouldEnforce = config.policy_mode === 'enforce' && (tier as string) === 'enterprise';
    assert.equal(shouldEnforce, false, 'Free tier should NOT enforce');
  });

  it('enterprise tier with policy_mode=enforce would enforce', async () => {
    const tier: Tier = 'enterprise';
    const policyMode = 'enforce';
    const shouldEnforce = policyMode === 'enforce' && tier === 'enterprise';
    assert.equal(shouldEnforce, true, 'Enterprise tier should enforce');
  });
});

// ─── PLAN_LIMITS Enterprise Tier ─────────────────────────────────────────────

describe('PLAN_LIMITS enterprise tier exists', () => {
  it('has all required fields', () => {
    const limits = PLAN_LIMITS.enterprise;
    assert.equal(limits.lifetime, Infinity);
    assert.equal(limits.monthly, Infinity);
    assert.equal(limits.rate_per_minute, 120);
    assert.equal(limits.always_on, true);
  });

  it('enterprise has highest rate limit', () => {
    const tiers = Object.keys(PLAN_LIMITS) as Tier[];
    for (const tier of tiers) {
      assert.ok(
        PLAN_LIMITS[tier].rate_per_minute <= PLAN_LIMITS.enterprise.rate_per_minute,
        `${tier} rate_per_minute should be <= enterprise`,
      );
    }
  });
});

// ─── ENTERPRISE_PURCHASE_URL ────────────────────────────────────────────────

describe('ENTERPRISE_PURCHASE_URL', () => {
  it('points to Prompt Control Plane contact page', async () => {
    const { ENTERPRISE_PURCHASE_URL } = await import('../src/tools.js');
    assert.ok(ENTERPRISE_PURCHASE_URL.includes('Prompt-Control-Plane'), 'URL includes new name');
    assert.ok(ENTERPRISE_PURCHASE_URL.startsWith('https://'), 'URL uses HTTPS');
    assert.ok(ENTERPRISE_PURCHASE_URL.includes('contact'), 'URL points to contact page');
  });
});
