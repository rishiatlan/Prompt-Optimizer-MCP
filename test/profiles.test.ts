// test/profiles.test.ts — Profile system: frozen objects, suggest mapping, resolve fallback.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES, suggestProfile, resolveProfile } from '../src/profiles.js';
import { RISK_ESCALATION_THRESHOLD } from '../src/rules.js';
import type { OptimizationProfile, ReasoningComplexity } from '../src/types.js';

// ─── Frozen profiles ──────────────────────────────────────────────────────

describe('PROFILES: frozen objects', () => {
  it('has exactly 5 profiles', () => {
    assert.equal(Object.keys(PROFILES).length, 5);
  });

  it('all 5 profile names are present', () => {
    const expected: OptimizationProfile[] = [
      'cost_minimizer', 'balanced', 'quality_first', 'creative', 'enterprise_safe',
    ];
    for (const name of expected) {
      assert.ok(PROFILES[name], `Missing profile: ${name}`);
    }
  });

  it('profiles are frozen (immutable)', () => {
    assert.ok(Object.isFrozen(PROFILES), 'PROFILES should be frozen');
    for (const [name, spec] of Object.entries(PROFILES)) {
      assert.ok(Object.isFrozen(spec), `Profile ${name} should be frozen`);
    }
  });

  it('each profile has required fields', () => {
    for (const [name, spec] of Object.entries(PROFILES)) {
      assert.ok(['small', 'mid', 'top'].includes(spec.tier), `${name}: invalid tier ${spec.tier}`);
      assert.ok(typeof spec.temperature === 'number', `${name}: temperature must be number`);
      assert.ok(spec.temperature >= 0 && spec.temperature <= 1, `${name}: temperature out of range`);
      assert.ok(typeof spec.maxTokensCap === 'number', `${name}: maxTokensCap must be number`);
      assert.ok(['low', 'medium', 'high'].includes(spec.budgetSensitivity), `${name}: invalid budgetSensitivity`);
      assert.ok(['low', 'medium', 'high'].includes(spec.latencySensitivity), `${name}: invalid latencySensitivity`);
    }
  });
});

// ─── suggestProfile (G5: deterministic mapping) ────────────────────────────

describe('suggestProfile (G5)', () => {
  it('simple_factual → cost_minimizer', () => {
    assert.equal(suggestProfile('simple_factual', 0), 'cost_minimizer');
    assert.equal(suggestProfile('simple_factual', 50), 'cost_minimizer');
  });

  it('analytical → balanced', () => {
    assert.equal(suggestProfile('analytical', 0), 'balanced');
    assert.equal(suggestProfile('analytical', 80), 'balanced');
  });

  it('multi_step + high risk → quality_first', () => {
    assert.equal(suggestProfile('multi_step', RISK_ESCALATION_THRESHOLD), 'quality_first');
    assert.equal(suggestProfile('multi_step', 80), 'quality_first');
  });

  it('multi_step + low risk → balanced', () => {
    assert.equal(suggestProfile('multi_step', RISK_ESCALATION_THRESHOLD - 1), 'balanced');
    assert.equal(suggestProfile('multi_step', 0), 'balanced');
  });

  it('creative → creative', () => {
    assert.equal(suggestProfile('creative', 0), 'creative');
    assert.equal(suggestProfile('creative', 80), 'creative');
  });

  it('long_context → balanced', () => {
    assert.equal(suggestProfile('long_context', 0), 'balanced');
  });

  it('agent_orchestration + high risk → quality_first', () => {
    assert.equal(suggestProfile('agent_orchestration', RISK_ESCALATION_THRESHOLD), 'quality_first');
  });

  it('agent_orchestration + low risk → balanced', () => {
    assert.equal(suggestProfile('agent_orchestration', RISK_ESCALATION_THRESHOLD - 1), 'balanced');
  });

  it('enterprise_safe is NEVER auto-suggested', () => {
    const allComplexities: ReasoningComplexity[] = [
      'simple_factual', 'analytical', 'multi_step', 'creative', 'long_context', 'agent_orchestration',
    ];
    for (const complexity of allComplexities) {
      for (const risk of [0, 20, 40, 60, 80, 100]) {
        const result = suggestProfile(complexity, risk);
        assert.notEqual(result, 'enterprise_safe',
          `enterprise_safe should never be auto-suggested (complexity=${complexity}, risk=${risk})`);
      }
    }
  });
});

// ─── resolveProfile ───────────────────────────────────────────────────────

describe('resolveProfile', () => {
  it('valid profile name passes through', () => {
    const path: string[] = [];
    assert.equal(resolveProfile('cost_minimizer', path), 'cost_minimizer');
    assert.equal(resolveProfile('enterprise_safe', path), 'enterprise_safe');
    assert.equal(path.length, 0, 'No fallback entries for valid profiles');
  });

  it('undefined → balanced', () => {
    const path: string[] = [];
    assert.equal(resolveProfile(undefined, path), 'balanced');
  });

  it('invalid name → balanced + decision_path entry', () => {
    const path: string[] = [];
    assert.equal(resolveProfile('turbo_mode', path), 'balanced');
    assert.equal(path.length, 1);
    assert.ok(path[0].includes('profile_fallback=turbo_mode→balanced'));
  });
});
