// test/api.test.ts — Barrel export + optimize() convenience function tests.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// All imports come from the barrel — proves re-exports work.
import {
  optimize,
  analyzePrompt,
  detectTaskType,
  scorePrompt,
  generateChecklist,
  compilePrompt,
  compressContext,
  estimateCost,
  estimateTokens,
  estimateCostForText,
  PRICING_DATA,
  runRules,
  extractBlockingQuestions,
  extractAssumptions,
  getElevatedRisk,
  validateLicenseKey,
  canonicalizePayload,
  PRODUCTION_PUBLIC_KEY_PEM,
  isCodeTask,
  isProseTask,
  PLAN_LIMITS,
  PRO_PURCHASE_URL,
  POWER_PURCHASE_URL,
} from '../src/api.js';

import type {
  OptimizeResult,
  IntentSpec,
  QualityScore,
  CompilationChecklist,
  CostEstimate,
} from '../src/api.js';

// ─── Barrel Exports ──────────────────────────────────────────────────────────

describe('Barrel exports', () => {
  it('all named exports are functions or objects', () => {
    // Functions
    const fns = [
      analyzePrompt, detectTaskType, scorePrompt, generateChecklist,
      compilePrompt, compressContext, estimateCost, estimateTokens,
      estimateCostForText, runRules, extractBlockingQuestions,
      extractAssumptions, getElevatedRisk, validateLicenseKey,
      canonicalizePayload, isCodeTask, isProseTask, optimize,
    ];
    for (const fn of fns) {
      assert.equal(typeof fn, 'function', `${fn.name || 'anonymous'} should be a function`);
    }

    // Constants
    assert.equal(typeof PRICING_DATA, 'object');
    assert.equal(typeof PRODUCTION_PUBLIC_KEY_PEM, 'string');
    assert.equal(typeof PLAN_LIMITS, 'object');
    assert.equal(typeof PRO_PURCHASE_URL, 'string');
    assert.equal(typeof POWER_PURCHASE_URL, 'string');
  });

  it('purchase URLs are configured (Razorpay)', () => {
    assert.equal(typeof PRO_PURCHASE_URL, 'string', 'Pro URL should be a string');
    assert.equal(typeof POWER_PURCHASE_URL, 'string', 'Power URL should be a string');
    assert.ok(PRO_PURCHASE_URL.length > 0, 'Pro URL should not be empty');
    assert.ok(POWER_PURCHASE_URL.length > 0, 'Power URL should not be empty');
    // When real Razorpay URLs are set, these will also pass:
    if (!PRO_PURCHASE_URL.includes('TODO')) {
      assert.ok(PRO_PURCHASE_URL.startsWith('https://'), 'Pro URL should be HTTPS');
      assert.ok(POWER_PURCHASE_URL.startsWith('https://'), 'Power URL should be HTTPS');
      assert.notEqual(PRO_PURCHASE_URL, POWER_PURCHASE_URL, 'Pro and Power URLs should be different');
    }
  });
});

// ─── optimize() ──────────────────────────────────────────────────────────────

describe('optimize()', () => {
  const testPrompt = 'Write a Python function that calculates the Fibonacci sequence up to n terms. Include type hints, docstring, and handle edge cases like negative numbers.';

  it('returns correct OptimizeResult shape', () => {
    const result = optimize(testPrompt);

    // All 5 pipeline outputs present
    assert.ok(result.intent, 'should have intent');
    assert.ok(result.quality, 'should have quality');
    assert.ok(typeof result.compiled === 'string' && result.compiled.length > 0, 'should have compiled string');
    assert.ok(Array.isArray(result.changes), 'should have changes array');
    assert.ok(result.checklist, 'should have checklist');
    assert.ok(result.cost, 'should have cost');

    // IntentSpec shape
    assert.ok(result.intent.task_type, 'intent should have task_type');
    assert.ok(result.intent.user_intent, 'intent should have user_intent');

    // QualityScore shape
    assert.equal(typeof result.quality.total, 'number');
    assert.equal(result.quality.max, 100);
    assert.equal(result.quality.dimensions.length, 5);

    // CostEstimate shape
    assert.ok(result.cost.input_tokens > 0, 'should estimate tokens');
    assert.ok(Array.isArray(result.cost.costs), 'should have costs array');
    assert.ok(result.cost.recommended_model, 'should have recommended_model');
  });

  it('is deterministic (same input → same output)', () => {
    const a = optimize(testPrompt);
    const b = optimize(testPrompt);

    assert.equal(a.quality.total, b.quality.total);
    assert.equal(a.compiled, b.compiled);
    assert.equal(a.cost.input_tokens, b.cost.input_tokens);
    assert.deepEqual(a.checklist.items.map(i => i.name), b.checklist.items.map(i => i.name));
  });

  it('accepts and uses context parameter', () => {
    const context = 'This is a math utility library. All functions should be pure with no side effects.';
    const withCtx = optimize(testPrompt, context);
    const withoutCtx = optimize(testPrompt);

    // Context should directionally increase token estimate
    assert.ok(
      withCtx.cost.input_tokens > withoutCtx.cost.input_tokens,
      `with context (${withCtx.cost.input_tokens}) should have more tokens than without (${withoutCtx.cost.input_tokens})`,
    );
  });

  it('respects target=openai', () => {
    const result = optimize(testPrompt, undefined, 'openai');
    assert.ok(result.compiled.includes('[SYSTEM]'), 'openai target should produce [SYSTEM] format');
  });

  it('respects target=generic', () => {
    const result = optimize(testPrompt, undefined, 'generic');
    assert.ok(result.compiled.includes('## '), 'generic target should produce markdown headers');
  });

  it('defaults to claude target with XML tags', () => {
    const result = optimize(testPrompt);
    assert.ok(
      result.compiled.includes('<role>') || result.compiled.includes('<goal>'),
      'default target should produce XML-tagged format',
    );
  });
});

// ─── Individual Function Smoke Tests ─────────────────────────────────────────

describe('Individual function exports', () => {
  it('scorePrompt returns 5 dimensions totaling ≤100', () => {
    const spec = analyzePrompt('Build a REST API for user management');
    const score = scorePrompt(spec);
    assert.equal(score.dimensions.length, 5);
    assert.ok(score.total >= 0 && score.total <= 100, `total ${score.total} should be 0-100`);
    assert.equal(score.max, 100);
  });

  it('compilePrompt returns prompt string + changes array', () => {
    const spec = analyzePrompt('Build a REST API for user management');
    const result = compilePrompt(spec);
    assert.equal(typeof result.prompt, 'string');
    assert.ok(result.prompt.length > 0);
    assert.ok(Array.isArray(result.changes));
    assert.equal(result.format_version, 1);
  });

  it('estimateCost returns estimates for 3 providers', () => {
    const cost = estimateCost('Hello world, this is a test prompt');
    const providers = new Set(cost.costs.map(c => c.provider));
    assert.ok(providers.has('anthropic'), 'should include anthropic');
    assert.ok(providers.has('openai'), 'should include openai');
    assert.ok(providers.has('google'), 'should include google');
  });
});

// ─── Packaging Validation ────────────────────────────────────────────────────

describe('Packaging validation', () => {
  // Tests run from dist/test/, so project root is two levels up
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(__dirname, '..', '..');

  it('all exports map paths exist as built files', () => {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));

    // Main + types
    assert.ok(fs.existsSync(path.join(projectRoot, pkgJson.main)), `main (${pkgJson.main}) should exist`);
    assert.ok(fs.existsSync(path.join(projectRoot, pkgJson.types)), `types (${pkgJson.types}) should exist`);

    // Exports map
    for (const [key, entry] of Object.entries(pkgJson.exports)) {
      const exp = entry as Record<string, string>;
      if (exp.import) {
        assert.ok(fs.existsSync(path.join(projectRoot, exp.import)), `exports["${key}"].import (${exp.import}) should exist`);
      }
      if (exp.types) {
        assert.ok(fs.existsSync(path.join(projectRoot, exp.types)), `exports["${key}"].types (${exp.types}) should exist`);
      }
    }
  });

  it('dynamic import of built api.js resolves and exports optimize', async () => {
    // From dist/test/, the built api is at ../src/api.js (sibling directory)
    const apiPath = path.resolve(__dirname, '..', 'src', 'api.js');
    const apiModule = await import(apiPath);
    assert.equal(typeof apiModule.optimize, 'function', 'built api.js should export optimize()');
    assert.equal(typeof apiModule.analyzePrompt, 'function', 'built api.js should export analyzePrompt()');
    assert.equal(typeof apiModule.scorePrompt, 'function', 'built api.js should export scorePrompt()');
  });
});
