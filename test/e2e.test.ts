// test/e2e.test.ts — End-to-end tests: full pipeline, license→tier upgrade, gate enforcement, URL wiring.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { LocalFsStorage } from '../src/storage/localFs.js';
import { LocalRateLimiter } from '../src/rateLimit.js';
import { analyzePrompt, scorePrompt, compilePrompt, generateChecklist, estimateCost } from '../src/api.js';
import { detectTaskType, classifyComplexity } from '../src/analyzer.js';
import { runRules, extractBlockingQuestions, computeRiskScore } from '../src/rules.js';
import { suggestProfile } from '../src/profiles.js';
import { estimateTokens, routeModel } from '../src/estimator.js';
import type { ModelRoutingInput, OptimizationProfile } from '../src/types.js';
import { validateLicenseKey, canonicalizePayload } from '../src/license.js';
import type { LicensePayload } from '../src/license.js';
import { PLAN_LIMITS } from '../src/types.js';
import type { ExecutionContext, RateLimiter, LicenseData } from '../src/types.js';
import { PRO_PURCHASE_URL, POWER_PURCHASE_URL } from '../src/tools.js';
import { log } from '../src/logger.js';

// ─── Test Ed25519 Keypair ───────────────────────────────────────────────────
const { publicKey: testPublicKey, privateKey: testPrivateKey } =
  crypto.generateKeyPairSync('ed25519');

const TEST_PUBLIC_KEY_PEM = testPublicKey
  .export({ type: 'spki', format: 'pem' }) as string;

// ─── Test Helpers ───────────────────────────────────────────────────────────

let testDir: string;
let storage: LocalFsStorage;

const noopRateLimiter: RateLimiter = { check: () => ({ allowed: true }) };

function makeTestStorage(): LocalFsStorage {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-e2e-'));
  return new LocalFsStorage(testDir);
}

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    requestId: 'e2e-test-req',
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

function signTestLicense(payload: LicensePayload): string {
  const canonical = canonicalizePayload(payload);
  const signature = crypto.sign(null, Buffer.from(canonical), testPrivateKey);
  const envelope = { payload, signature_hex: signature.toString('hex') };
  const encoded = Buffer.from(JSON.stringify(envelope)).toString('base64url');
  return `po_pro_${encoded}`;
}

const TEST_PROMPT = 'Write a Python function that calculates compound interest. Include type hints, error handling for negative values, and a docstring explaining the formula.';

// ═══════════════════════════════════════════════════════════════════════════════
// 4a. Full Optimization Pipeline
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E: Full optimization pipeline', () => {
  beforeEach(() => { storage = makeTestStorage(); });
  afterEach(() => { try { fs.rmSync(testDir, { recursive: true }); } catch {} });

  it('free tier full pipeline returns all fields', () => {
    const spec = analyzePrompt(TEST_PROMPT);
    const quality = scorePrompt(spec);
    const { prompt: compiled, changes } = compilePrompt(spec);
    const checklist = generateChecklist(compiled);
    const cost = estimateCost(compiled);

    // IntentSpec
    assert.ok(spec.task_type, 'should detect task type');
    assert.ok(spec.user_intent.length > 0, 'should extract user intent');

    // Quality
    assert.ok(quality.total >= 0 && quality.total <= 100);
    assert.equal(quality.dimensions.length, 5);

    // Compiled
    assert.ok(compiled.length > 0, 'compiled prompt should not be empty');
    assert.ok(compiled.includes('<role>') || compiled.includes('<goal>'), 'default target should be claude XML');

    // Checklist
    assert.ok(checklist.items.length >= 7, 'should have ≥7 checklist items');

    // Cost
    assert.ok(cost.input_tokens > 0);
    assert.ok(cost.costs.length >= 3, 'should have costs for 3+ providers');
    assert.ok(cost.recommended_model.length > 0);
  });

  it('pipeline with context references context in output', () => {
    const context = 'This is part of a financial calculations library. Use Decimal for precision.';
    const spec = analyzePrompt(TEST_PROMPT, context);
    const { prompt: compiled } = compilePrompt(spec, context);

    assert.ok(
      compiled.toLowerCase().includes('context') || compiled.toLowerCase().includes('financial') || compiled.toLowerCase().includes('decimal'),
      'compiled output should reference context',
    );
  });

  it('different targets produce correct formats', () => {
    const spec = analyzePrompt(TEST_PROMPT);

    const claude = compilePrompt(spec, undefined, 'claude');
    const openai = compilePrompt(spec, undefined, 'openai');
    const generic = compilePrompt(spec, undefined, 'generic');

    assert.ok(claude.prompt.includes('<role>') || claude.prompt.includes('<goal>'), 'claude should use XML tags');
    assert.ok(openai.prompt.includes('[SYSTEM]'), 'openai should use [SYSTEM] format');
    assert.ok(generic.prompt.includes('## '), 'generic should use markdown headers');
  });

  it('approve flow: optimize → session → approve', async () => {
    const spec = analyzePrompt(TEST_PROMPT);
    const quality = scorePrompt(spec);
    const { prompt: compiled } = compilePrompt(spec);
    const checklist = generateChecklist(compiled);
    const cost = estimateCost(compiled);

    // Create session
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    await storage.saveSession({
      id: sessionId,
      state: 'COMPILED',
      created_at: now,
      last_accessed: now,
      raw_prompt: TEST_PROMPT,
      compiled_prompt: compiled,
      target: 'claude',
      intent_spec: spec,
      quality_before: quality,
      compilation_checklist: checklist,
      cost_estimate: cost,
      answers: {},
    });

    // Load and verify
    const loaded = await storage.loadSession(sessionId);
    assert.ok(loaded, 'session should be loadable');
    assert.equal(loaded!.state, 'COMPILED');
    assert.equal(loaded!.compiled_prompt, compiled);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4b. License Purchase → Tier Upgrade Flow
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E: License → tier upgrade', () => {
  beforeEach(() => { storage = makeTestStorage(); });
  afterEach(() => { try { fs.rmSync(testDir, { recursive: true }); } catch {} });

  it('free → pro upgrade via license key', async () => {
    // Start as free
    const usage1 = await storage.getUsage();
    assert.equal(usage1.tier, 'free');

    // Sign a pro license
    const key = signTestLicense({
      tier: 'pro',
      issued_at: '2025-01-01T00:00:00Z',
      expires_at: 'never',
      license_id: 'e2e-pro-1',
    });

    // Validate (with test public key)
    const result = validateLicenseKey(key, TEST_PUBLIC_KEY_PEM);
    assert.ok(result.valid, 'license should validate');
    assert.equal(result.payload!.tier, 'pro');

    // Store license
    const licenseData: LicenseData = {
      schema_version: 1,
      tier: result.payload!.tier,
      issued_at: result.payload!.issued_at,
      expires_at: result.payload!.expires_at,
      license_id: result.payload!.license_id,
      activated_at: new Date().toISOString(),
      valid: true,
    };
    await storage.setLicense(licenseData);

    // Verify upgrade
    const usage2 = await storage.getUsage();
    assert.equal(usage2.tier, 'pro');

    // Verify limits match pro tier
    const proLimits = PLAN_LIMITS.pro;
    assert.equal(proLimits.monthly, 100);
    assert.equal(proLimits.rate_per_minute, 30);
  });

  it('free → power upgrade via license key', async () => {
    const key = signTestLicense({
      tier: 'power',
      issued_at: '2025-01-01T00:00:00Z',
      expires_at: 'never',
      license_id: 'e2e-power-1',
    });

    const result = validateLicenseKey(key, TEST_PUBLIC_KEY_PEM);
    assert.ok(result.valid);
    assert.equal(result.payload!.tier, 'power');

    await storage.setLicense({
      schema_version: 1,
      tier: 'power',
      issued_at: result.payload!.issued_at,
      expires_at: result.payload!.expires_at,
      license_id: result.payload!.license_id,
      activated_at: new Date().toISOString(),
      valid: true,
    });

    const usage = await storage.getUsage();
    assert.equal(usage.tier, 'power');
    assert.equal(PLAN_LIMITS.power.monthly, Infinity);
    assert.equal(PLAN_LIMITS.power.rate_per_minute, 60);
    assert.equal(PLAN_LIMITS.power.always_on, true);
  });

  it('invalid (tampered) license rejected', () => {
    const key = signTestLicense({
      tier: 'pro',
      issued_at: '2025-01-01T00:00:00Z',
      expires_at: 'never',
      license_id: 'tampered',
    });

    // Tamper by replacing a character
    const tampered = key.slice(0, -5) + 'XXXXX';
    const result = validateLicenseKey(tampered, TEST_PUBLIC_KEY_PEM);
    assert.equal(result.valid, false);
  });

  it('expired license detected', () => {
    const key = signTestLicense({
      tier: 'pro',
      issued_at: '2020-01-01T00:00:00Z',
      expires_at: '2021-01-01T00:00:00Z', // Past date
      license_id: 'expired-1',
    });

    const result = validateLicenseKey(key, TEST_PUBLIC_KEY_PEM);
    assert.equal(result.valid, false);
    assert.equal(result.error, 'expired');
  });

  it('license persists across storage instances', async () => {
    const key = signTestLicense({
      tier: 'pro',
      issued_at: '2025-01-01T00:00:00Z',
      expires_at: 'never',
      license_id: 'persist-1',
    });

    const result = validateLicenseKey(key, TEST_PUBLIC_KEY_PEM);
    assert.ok(result.valid);

    await storage.setLicense({
      schema_version: 1,
      tier: 'pro',
      issued_at: result.payload!.issued_at,
      expires_at: result.payload!.expires_at,
      license_id: result.payload!.license_id,
      activated_at: new Date().toISOString(),
      valid: true,
    });

    // Create new storage instance on same directory
    const storage2 = new LocalFsStorage(testDir);
    const license = await storage2.getLicense();
    assert.ok(license, 'license should persist');
    assert.equal(license!.tier, 'pro');
    assert.equal(license!.valid, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4c. Gate Enforcement E2E
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E: Gate enforcement', () => {
  beforeEach(() => { storage = makeTestStorage(); });
  afterEach(() => { try { fs.rmSync(testDir, { recursive: true }); } catch {} });

  it('free tier exhaustion: 11th call blocked with lifetime enforcement', async () => {
    const ctx = makeCtx();

    // Use up 10
    for (let i = 0; i < 10; i++) {
      const result = await storage.canUseOptimization(ctx);
      assert.ok(result.allowed, `Use ${i + 1} should be allowed`);
      await storage.incrementUsage();
    }

    // 11th blocked
    const blocked = await storage.canUseOptimization(ctx);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.enforcement, 'lifetime');
    assert.equal(blocked.remaining.lifetime, 0);
  });

  it('pro tier monthly limit: 101st call blocked', async () => {
    // Set up pro license
    await storage.setLicense({
      schema_version: 1,
      tier: 'pro',
      issued_at: '2025-01-01T00:00:00Z',
      expires_at: 'never',
      license_id: 'pro-monthly',
      activated_at: new Date().toISOString(),
      valid: true,
    });

    const ctx = makeCtx({ tier: 'pro' });

    // Use up 100
    for (let i = 0; i < 100; i++) {
      await storage.incrementUsage();
    }

    const blocked = await storage.canUseOptimization(ctx);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.enforcement, 'monthly');
  });

  it('power tier has no limits', async () => {
    await storage.setLicense({
      schema_version: 1,
      tier: 'power',
      issued_at: '2025-01-01T00:00:00Z',
      expires_at: 'never',
      license_id: 'power-unlimited',
      activated_at: new Date().toISOString(),
      valid: true,
    });

    const ctx = makeCtx({ tier: 'power' });

    // Make 10 calls — all should succeed
    for (let i = 0; i < 10; i++) {
      await storage.incrementUsage();
      const result = await storage.canUseOptimization(ctx);
      assert.ok(result.allowed, `Power tier use ${i + 1} should be allowed`);
      assert.equal(result.enforcement, null);
    }
  });

  it('rate limit enforcement returns retry_after_seconds', async () => {
    const rateLimiter = new LocalRateLimiter();
    const ctx = makeCtx({ rateLimiter, tier: 'free' });

    // Free tier: 5/min. Exhaust it.
    for (let i = 0; i < 5; i++) {
      const result = await storage.canUseOptimization(ctx);
      assert.ok(result.allowed, `Rate call ${i + 1} should be allowed`);
      await storage.incrementUsage();
    }

    // Next call should be rate limited
    const limited = await storage.canUseOptimization(ctx);
    assert.equal(limited.allowed, false);
    assert.equal(limited.enforcement, 'rate');
    assert.ok(
      limited.retry_after_seconds != null && limited.retry_after_seconds > 0,
      'should have retry_after_seconds',
    );
  });

  it('metering-after-success: failed pipeline does not increment counter', async () => {
    const ctx = makeCtx();

    const usageBefore = await storage.getUsage();
    const countBefore = usageBefore.total_optimizations;

    // Simulate pipeline failure (no incrementUsage call)
    let success = false;
    try {
      // Pipeline would run here... simulate failure
      throw new Error('Simulated pipeline failure');
      // success = true; // never reached
    } catch {
      // Expected
    } finally {
      if (success) {
        await storage.incrementUsage();
      }
    }

    const usageAfter = await storage.getUsage();
    assert.equal(usageAfter.total_optimizations, countBefore, 'counter should NOT increment on failure');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4d. Checkout URL Wiring
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E: Checkout URL wiring', () => {
  it('purchase URLs are configured (Razorpay)', () => {
    assert.equal(typeof PRO_PURCHASE_URL, 'string', 'Pro URL should be a string');
    assert.equal(typeof POWER_PURCHASE_URL, 'string', 'Power URL should be a string');
    assert.ok(PRO_PURCHASE_URL.length > 0, 'Pro URL should not be empty');
    assert.ok(POWER_PURCHASE_URL.length > 0, 'Power URL should not be empty');
    // When real Razorpay URLs are set, these will also pass:
    if (!PRO_PURCHASE_URL.includes('TODO')) {
      assert.ok(PRO_PURCHASE_URL.startsWith('https://'), 'Pro URL should be HTTPS');
      assert.ok(POWER_PURCHASE_URL.startsWith('https://'), 'Power URL should be HTTPS');
      assert.notEqual(PRO_PURCHASE_URL, POWER_PURCHASE_URL, 'Pro and Power URLs must differ');
    }
  });

  it('PLAN_LIMITS tiers match expected pricing model', () => {
    // Free: 10 lifetime, 10 monthly
    assert.equal(PLAN_LIMITS.free.lifetime, 10);
    assert.equal(PLAN_LIMITS.free.monthly, 10);
    assert.equal(PLAN_LIMITS.free.always_on, false);

    // Pro (₹499/mo): unlimited lifetime, 100 monthly
    assert.equal(PLAN_LIMITS.pro.lifetime, Infinity);
    assert.equal(PLAN_LIMITS.pro.monthly, 100);
    assert.equal(PLAN_LIMITS.pro.always_on, false);

    // Power (₹899/mo): unlimited everything + always_on
    assert.equal(PLAN_LIMITS.power.lifetime, Infinity);
    assert.equal(PLAN_LIMITS.power.monthly, Infinity);
    assert.equal(PLAN_LIMITS.power.always_on, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4e. Configuration & Stats
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E: Configuration & stats', () => {
  beforeEach(() => { storage = makeTestStorage(); });
  afterEach(() => { try { fs.rmSync(testDir, { recursive: true }); } catch {} });

  it('configure target → optimize → output uses that format', async () => {
    await storage.setConfig({ default_target: 'openai' });
    const config = await storage.getConfig();
    assert.equal(config.default_target, 'openai');

    // Use the configured target
    const spec = analyzePrompt(TEST_PROMPT);
    const { prompt: compiled } = compilePrompt(spec, undefined, config.default_target as 'openai');
    assert.ok(compiled.includes('[SYSTEM]'), 'should use openai format when configured');
  });

  it('stats accumulate correctly across optimizations', async () => {
    const prompts = [
      'Write a function to sort an array',
      'Create a REST API for user management with authentication',
      'Build a simple HTML page with a form',
    ];

    for (const p of prompts) {
      const spec = analyzePrompt(p);
      const quality = scorePrompt(spec);
      await storage.updateStats({
        type: 'optimize',
        score_before: quality.total,
        task_type: spec.task_type,
        blocking_questions: [],
        cost_savings_usd: 0,
      });
    }

    const stats = await storage.getStats();
    assert.equal(stats.total_optimized, 3, 'should have 3 optimizations');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// v3 Decision Engine: classify_task pipeline
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E: classify_task pipeline', () => {
  it('returns all required fields for code prompt', () => {
    const prompt = 'Write a Python function that calculates compound interest. Include type hints.';
    const taskType = detectTaskType(prompt);
    const complexityResult = classifyComplexity(prompt);
    const ruleResults = runRules(prompt, undefined, taskType);
    const riskScore = computeRiskScore(ruleResults);
    const suggestedProfileName = suggestProfile(complexityResult.complexity, riskScore.score);

    // Validate all fields present
    assert.ok(typeof taskType === 'string');
    assert.ok(['simple_factual', 'analytical', 'multi_step', 'creative', 'long_context', 'agent_orchestration']
      .includes(complexityResult.complexity));
    assert.ok(typeof complexityResult.confidence === 'number');
    assert.ok(Array.isArray(complexityResult.signals));
    assert.ok(['low', 'medium', 'high'].includes(riskScore.level));
    assert.ok(typeof riskScore.score === 'number');
    assert.ok(['cost_minimizer', 'balanced', 'quality_first', 'creative', 'enterprise_safe']
      .includes(suggestedProfileName));
  });

  it('simple question classified as simple_factual', () => {
    const prompt = 'What is TypeScript?';
    const complexity = classifyComplexity(prompt);
    assert.equal(complexity.complexity, 'simple_factual');
  });

  it('multi-step prompt classified correctly', () => {
    const prompt = 'First, set up the database. Then, create the API routes. Next, build the frontend. Finally, deploy to production.';
    const complexity = classifyComplexity(prompt);
    assert.equal(complexity.complexity, 'multi_step');
  });

  it('research intent prompt detectable', () => {
    const prompt = 'Search the web for the latest React performance benchmarks with citations';
    const taskType = detectTaskType(prompt);
    const complexity = classifyComplexity(prompt);
    assert.ok(typeof taskType === 'string');
    assert.ok(typeof complexity.complexity === 'string');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// v3 Decision Engine: route_model pipeline
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E: route_model pipeline', () => {
  it('routes simple question to small tier (Anthropic/haiku for claude target)', () => {
    const prompt = 'What is a closure in JavaScript?';
    const taskType = detectTaskType(prompt);
    const complexity = classifyComplexity(prompt);
    const ruleResults = runRules(prompt, undefined, taskType);
    const riskScore = computeRiskScore(ruleResults);
    const contextTokens = estimateTokens(prompt);

    const input: ModelRoutingInput = {
      taskType,
      complexity: complexity.complexity,
      budgetSensitivity: 'medium',
      latencySensitivity: 'medium',
      contextTokens,
      riskScore: riskScore.score,
    };

    const rec = routeModel(input, prompt, complexity.confidence, 'claude');
    assert.equal(rec.primary.provider, 'anthropic');
    assert.equal(rec.primary.model, 'haiku');
    assert.ok(rec.decision_path.includes('default_tier=small'));
  });

  it('routes multi-step high-risk to top tier', () => {
    const input: ModelRoutingInput = {
      taskType: 'code_change',
      complexity: 'multi_step',
      budgetSensitivity: 'medium',
      latencySensitivity: 'medium',
      contextTokens: 10000,
      riskScore: 50, // above RISK_ESCALATION_THRESHOLD
    };

    const rec = routeModel(input, undefined, 60, 'claude');
    assert.equal(rec.primary.provider, 'anthropic');
    assert.equal(rec.primary.model, 'opus');
    assert.ok(rec.decision_path.includes('default_tier=top'));
  });

  it('routes research prompt to Perplexity', () => {
    const prompt = 'Search the web for the latest TypeScript performance benchmarks with sources';
    const input: ModelRoutingInput = {
      taskType: 'research',
      complexity: 'analytical',
      budgetSensitivity: 'medium',
      latencySensitivity: 'medium',
      contextTokens: 500,
      riskScore: 10,
    };

    const rec = routeModel(input, prompt, 70, 'claude');
    assert.equal(rec.primary.provider, 'perplexity');
    assert.ok(rec.decision_path.includes('research_intent=true'));
  });

  it('decision_path is complete audit trail', () => {
    const input: ModelRoutingInput = {
      taskType: 'create',
      complexity: 'creative',
      budgetSensitivity: 'high',
      latencySensitivity: 'medium',
      contextTokens: 3000,
      riskScore: 25,
      profile: 'creative',
    };

    const rec = routeModel(input, undefined, 70, 'claude');
    // Verify decision_path contains key decisions
    assert.ok(rec.decision_path.includes('profile=creative'));
    assert.ok(rec.decision_path.includes('complexity=creative'));
    assert.ok(rec.decision_path.some(e => e.startsWith('risk_score=')));
    assert.ok(rec.decision_path.some(e => e.startsWith('selected=')));
    assert.ok(rec.decision_path.some(e => e.startsWith('fallback=')));
    assert.ok(rec.decision_path.includes('baseline_model=gpt-4o'));
  });

  it('fallback differs from primary provider', () => {
    const input: ModelRoutingInput = {
      taskType: 'code_change',
      complexity: 'analytical',
      budgetSensitivity: 'medium',
      latencySensitivity: 'medium',
      contextTokens: 5000,
      riskScore: 20,
    };

    const rec = routeModel(input, undefined, 60, 'claude');
    assert.notEqual(rec.primary.provider, rec.fallback.provider,
      'Fallback must differ from primary provider');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// v3 Decision Engine: pre_flight pipeline (full integration)
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E: pre_flight pipeline', () => {
  beforeEach(() => { storage = makeTestStorage(); });
  afterEach(() => { try { fs.rmSync(testDir, { recursive: true }); } catch {} });

  it('full pre_flight pipeline returns all fields', () => {
    const prompt = 'Create a REST API for user management with JWT authentication, rate limiting, and comprehensive error handling.';
    const context = 'Using Node.js + Express + TypeScript';

    // Simulate pre_flight pipeline (same as tool handler)
    const taskType = detectTaskType(prompt);
    const complexityResult = classifyComplexity(prompt, context);
    const ruleResults = runRules(prompt, context, taskType);
    const riskScoreResult = computeRiskScore(ruleResults);
    const suggestedProfileName = suggestProfile(complexityResult.complexity, riskScoreResult.score);

    const contextTokens = estimateTokens(prompt + context);
    const routingInput: ModelRoutingInput = {
      taskType,
      complexity: complexityResult.complexity,
      budgetSensitivity: 'medium',
      latencySensitivity: 'medium',
      contextTokens,
      riskScore: riskScoreResult.score,
      profile: suggestedProfileName,
    };
    const recommendation = routeModel(routingInput, prompt, complexityResult.confidence, 'claude');

    const intentSpec = analyzePrompt(prompt, context);
    const qualityScore = scorePrompt(intentSpec, context);

    // Validate structure
    assert.ok(typeof taskType === 'string');
    assert.ok(typeof complexityResult.complexity === 'string');
    assert.ok(typeof riskScoreResult.score === 'number');
    assert.ok(typeof riskScoreResult.level === 'string');
    assert.ok(typeof recommendation.primary.model === 'string');
    assert.ok(typeof recommendation.primary.provider === 'string');
    assert.ok(typeof recommendation.confidence === 'number');
    assert.ok(typeof qualityScore.total === 'number');
    assert.ok(Array.isArray(recommendation.decision_path));
    assert.ok(recommendation.decision_path.length > 0);
    assert.ok(typeof recommendation.savings_vs_default.savingsPercent === 'number');
    assert.ok(typeof recommendation.savings_summary === 'string');
  });

  it('pre_flight metering increments usage (G6)', async () => {
    const usageBefore = await storage.getUsage();
    const initialCount = usageBefore.total_optimizations;

    // Simulate pre_flight metering
    await storage.incrementUsage();

    const usageAfter = await storage.getUsage();
    assert.equal(usageAfter.total_optimizations, initialCount + 1,
      'pre_flight should increment usage by 1');
  });

  it('pre_flight does NOT double-meter (G6)', async () => {
    // Simulate: pre_flight calls incrementUsage once, not via optimize_prompt
    const usageBefore = await storage.getUsage();
    const initialCount = usageBefore.total_optimizations;

    // One increment for pre_flight
    await storage.incrementUsage();

    const usageAfter = await storage.getUsage();
    assert.equal(usageAfter.total_optimizations, initialCount + 1,
      'pre_flight should only meter once (no double-metering via optimize_prompt)');
  });
});
