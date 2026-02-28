// test/risk-score.test.ts — Risk scoring: dimensional scores, determinism, edge cases.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRiskScore,
  deriveRiskLevel,
  RISK_WEIGHTS,
  RISK_ESCALATION_THRESHOLD,
  runRules,
} from '../src/rules.js';
import type { RuleResult, RiskDimensions } from '../src/types.js';

// ─── Helper: create a triggered rule result ────────────────────────────────

function triggeredRule(name: string, severity: 'blocking' | 'non_blocking' = 'blocking'): RuleResult {
  return {
    rule_name: name,
    severity,
    triggered: true,
    message: `Test: ${name}`,
  };
}

// ─── deriveRiskLevel ──────────────────────────────────────────────────────

describe('deriveRiskLevel (G14)', () => {
  it('0-29 → low', () => {
    assert.equal(deriveRiskLevel(0), 'low');
    assert.equal(deriveRiskLevel(15), 'low');
    assert.equal(deriveRiskLevel(29), 'low');
  });

  it('30-59 → medium', () => {
    assert.equal(deriveRiskLevel(30), 'medium');
    assert.equal(deriveRiskLevel(45), 'medium');
    assert.equal(deriveRiskLevel(59), 'medium');
  });

  it('60-100 → high', () => {
    assert.equal(deriveRiskLevel(60), 'high');
    assert.equal(deriveRiskLevel(80), 'high');
    assert.equal(deriveRiskLevel(100), 'high');
  });
});

// ─── RISK_WEIGHTS contract ────────────────────────────────────────────────

describe('RISK_WEIGHTS contract', () => {
  it('covers all existing rule names', () => {
    const expectedRules = [
      'vague_objective', 'missing_target', 'scope_explosion',
      'high_risk_domain', 'no_constraints_high_risk', 'format_ambiguity',
      'multi_task_overload', 'generic_vague_ask', 'missing_audience',
      'no_clear_ask',
    ];
    for (const rule of expectedRules) {
      assert.ok(RISK_WEIGHTS[rule], `Missing weight for rule: ${rule}`);
    }
  });

  it('all weights have valid dimensions', () => {
    const validDimensions: Array<keyof RiskDimensions> = ['underspec', 'hallucination', 'scope', 'constraint'];
    for (const [name, weight] of Object.entries(RISK_WEIGHTS)) {
      assert.ok(validDimensions.includes(weight.dimension),
        `Rule ${name} has invalid dimension: ${weight.dimension}`);
      assert.ok(weight.base > 0, `Rule ${name} has non-positive base weight`);
      assert.ok(weight.blockingMultiplier >= 1.0, `Rule ${name} has multiplier < 1.0`);
    }
  });
});

// ─── RISK_ESCALATION_THRESHOLD ────────────────────────────────────────────

describe('RISK_ESCALATION_THRESHOLD (G11)', () => {
  it('is 40', () => {
    assert.equal(RISK_ESCALATION_THRESHOLD, 40);
  });
});

// ─── computeRiskScore ─────────────────────────────────────────────────────

describe('computeRiskScore', () => {
  it('returns score 0 when no rules triggered', () => {
    const result = computeRiskScore([]);
    assert.equal(result.score, 0);
    assert.equal(result.level, 'low');
    assert.equal(result.dimensions.underspec, 0);
    assert.equal(result.dimensions.hallucination, 0);
    assert.equal(result.dimensions.scope, 0);
    assert.equal(result.dimensions.constraint, 0);
  });

  it('all 4 dimensions always present (even when 0)', () => {
    const result = computeRiskScore([]);
    assert.ok('underspec' in result.dimensions);
    assert.ok('hallucination' in result.dimensions);
    assert.ok('scope' in result.dimensions);
    assert.ok('constraint' in result.dimensions);
  });

  it('scores a single blocking rule correctly', () => {
    const result = computeRiskScore([triggeredRule('vague_objective', 'blocking')]);
    // vague_objective: base=15, blockingMultiplier=1.5 → 22.5 → rounds to 23
    assert.equal(result.dimensions.underspec, 23);
    assert.equal(result.score, 23);
    assert.equal(result.level, 'low');
  });

  it('scores a single non-blocking rule correctly', () => {
    const result = computeRiskScore([triggeredRule('high_risk_domain', 'non_blocking')]);
    // high_risk_domain: base=10, not blocking → 10
    assert.equal(result.dimensions.constraint, 10);
    assert.equal(result.score, 10);
    assert.equal(result.level, 'low');
  });

  it('accumulates dimensions correctly for multiple rules', () => {
    const result = computeRiskScore([
      triggeredRule('vague_objective', 'blocking'),     // underspec: 15*1.5 = 22.5
      triggeredRule('missing_target', 'blocking'),      // underspec: 12*1.5 = 18
      triggeredRule('scope_explosion', 'blocking'),     // scope: 20*1.5 = 30
    ]);
    // underspec = round(22.5) + round(18) = 23 + 18 = actually, rounding happens after sum
    // Wait, the code rounds each dimension at the end, not each weight individually
    // underspec = 22.5 + 18 = 40.5 → round(40.5) = 41
    assert.equal(result.dimensions.underspec, 41);
    assert.equal(result.dimensions.scope, 30);
    assert.equal(result.score, 71);
    assert.equal(result.level, 'high');
  });

  it('caps total score at 100', () => {
    // Trigger many rules to exceed 100
    const result = computeRiskScore([
      triggeredRule('vague_objective', 'blocking'),
      triggeredRule('missing_target', 'blocking'),
      triggeredRule('scope_explosion', 'blocking'),
      triggeredRule('no_constraints_high_risk', 'blocking'),
      triggeredRule('generic_vague_ask', 'blocking'),
    ]);
    assert.ok(result.score <= 100, `Score ${result.score} exceeds 100`);
  });

  it('ignores unknown rule IDs (G4)', () => {
    const result = computeRiskScore([
      triggeredRule('unknown_future_rule', 'blocking'),
      triggeredRule('vague_objective', 'blocking'),
    ]);
    // Only vague_objective should count
    assert.equal(result.dimensions.underspec, 23); // 15 * 1.5 = 22.5 → 23
    assert.equal(result.dimensions.scope, 0);
  });

  it('is deterministic — same input → same output', () => {
    const rules = [
      triggeredRule('vague_objective', 'blocking'),
      triggeredRule('scope_explosion', 'non_blocking'),
    ];
    const result1 = computeRiskScore(rules);
    const result2 = computeRiskScore(rules);
    assert.deepEqual(result1, result2);
  });

  it('integrates with runRules()', () => {
    // A vague prompt should trigger vague rules
    const ruleResults = runRules('make it better', undefined, 'code_change');
    const riskScore = computeRiskScore(ruleResults);
    assert.ok(riskScore.score > 0, 'Vague code prompt should have non-zero risk');
    assert.ok(riskScore.dimensions.underspec > 0 || riskScore.dimensions.scope > 0,
      'Should have underspec or scope risk');
  });
});
