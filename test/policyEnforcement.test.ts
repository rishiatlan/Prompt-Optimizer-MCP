// test/policyEnforcement.test.ts — 15 tests for policy enforcement (v3.3.0)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePolicyViolations,
  checkRiskThreshold,
  buildPolicyEnforcementSummary,
  calculatePolicyHash,
  STRICTNESS_THRESHOLDS,
} from '../src/policy.js';
import type { RuleResult, PolicyViolation } from '../src/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRuleResult(overrides: Partial<RuleResult> = {}): RuleResult {
  return {
    rule_name: 'test_rule',
    triggered: false,
    severity: 'info',
    message: 'Test rule message',
    applies_to: 'all',
    ...overrides,
  } as RuleResult;
}

describe('policyEnforcement', async () => {
  // ─── evaluatePolicyViolations ─────────────────────────────────────────────

  it('1. advisory mode returns empty array', () => {
    const results = [makeRuleResult({ triggered: true, severity: 'blocking' })];
    const violations = evaluatePolicyViolations(results, { policy_mode: 'advisory' });
    assert.deepEqual(violations, []);
  });

  it('2. enforce + BLOCKING rule returns violation', () => {
    const results = [makeRuleResult({
      rule_name: 'no_pii',
      triggered: true,
      severity: 'blocking',
      message: 'PII detected',
      risk_elevation: 'high',
    })];
    const violations = evaluatePolicyViolations(results, { policy_mode: 'enforce' });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].rule_id, 'no_pii');
    assert.equal(violations[0].severity, 'blocking');
  });

  it('3. enforce + NON-BLOCKING rule returns no violation', () => {
    const results = [makeRuleResult({ triggered: true, severity: 'non_blocking' })];
    const violations = evaluatePolicyViolations(results, { policy_mode: 'enforce' });
    assert.equal(violations.length, 0);
  });

  it('4. enforce + multiple BLOCKING rules returns all', () => {
    const results = [
      makeRuleResult({ rule_name: 'rule_b', triggered: true, severity: 'blocking', message: 'B' }),
      makeRuleResult({ rule_name: 'rule_a', triggered: true, severity: 'blocking', message: 'A' }),
      makeRuleResult({ rule_name: 'rule_c', triggered: false, severity: 'blocking', message: 'C' }),
    ];
    const violations = evaluatePolicyViolations(results, { policy_mode: 'enforce' });
    assert.equal(violations.length, 2);
    // Sorted by rule_id
    assert.equal(violations[0].rule_id, 'rule_a');
    assert.equal(violations[1].rule_id, 'rule_b');
  });

  it('5. enforce + untriggered BLOCKING rule returns no violation', () => {
    const results = [makeRuleResult({ triggered: false, severity: 'blocking' })];
    const violations = evaluatePolicyViolations(results, { policy_mode: 'enforce' });
    assert.equal(violations.length, 0);
  });

  it('6. no policy_mode defaults to no violations', () => {
    const results = [makeRuleResult({ triggered: true, severity: 'blocking' })];
    const violations = evaluatePolicyViolations(results, {});
    assert.equal(violations.length, 0);
  });

  // ─── checkRiskThreshold ───────────────────────────────────────────────────

  it('7. score below threshold is not exceeded', () => {
    const result = checkRiskThreshold(50, 'standard');
    assert.equal(result.exceeded, false);
    assert.equal(result.score, 50);
    assert.equal(result.threshold, 60);
  });

  it('8. score AT threshold IS exceeded (>= semantics)', () => {
    const result = checkRiskThreshold(60, 'standard');
    assert.equal(result.exceeded, true, 'score == threshold should be exceeded (>=)');
    assert.equal(result.score, 60);
    assert.equal(result.threshold, 60);
  });

  it('9. score above threshold is exceeded', () => {
    const result = checkRiskThreshold(80, 'standard');
    assert.equal(result.exceeded, true);
  });

  it('10. relaxed=40 vs standard=60 vs strict=75', () => {
    assert.equal(STRICTNESS_THRESHOLDS.relaxed, 40);
    assert.equal(STRICTNESS_THRESHOLDS.standard, 60);
    assert.equal(STRICTNESS_THRESHOLDS.strict, 75);

    // Score of 50: exceeded for relaxed, not for standard, not for strict
    assert.equal(checkRiskThreshold(50, 'relaxed').exceeded, true);
    assert.equal(checkRiskThreshold(50, 'standard').exceeded, false);
    assert.equal(checkRiskThreshold(50, 'strict').exceeded, false);
  });

  it('11. unknown strictness falls back to standard (60)', () => {
    const result = checkRiskThreshold(60, 'custom_unknown');
    assert.equal(result.threshold, 60);
    assert.equal(result.exceeded, true);
  });

  // ─── buildPolicyEnforcementSummary ────────────────────────────────────────

  it('12. summary shape contract', () => {
    const violations: PolicyViolation[] = [{ rule_id: 'r1', description: 'd1', severity: 'blocking' }];
    const riskCheck = { exceeded: true, score: 70, threshold: 60 };
    const summary = buildPolicyEnforcementSummary(violations, riskCheck);

    assert.equal(summary.mode, 'enforce');
    assert.deepEqual(summary.violations, violations);
    assert.equal(summary.risk_threshold_exceeded, true);
    assert.equal(summary.blocked, true);
  });

  it('13. blocked=false when no violations and threshold not exceeded', () => {
    const summary = buildPolicyEnforcementSummary([], { exceeded: false, score: 30, threshold: 60 });
    assert.equal(summary.blocked, false);
    assert.equal(summary.violations.length, 0);
    assert.equal(summary.risk_threshold_exceeded, false);
  });

  // ─── calculatePolicyHash ──────────────────────────────────────────────────

  it('14. policy hash is deterministic', () => {
    const opts = {
      builtInRuleSetHash: 'abc123',
      customRuleSetHash: 'def456',
      policyMode: 'enforce',
      strictness: 'standard',
    };
    const h1 = calculatePolicyHash(opts);
    const h2 = calculatePolicyHash(opts);
    assert.equal(h1, h2);
    assert.match(h1, /^[a-f0-9]{64}$/); // SHA-256 hex
  });

  it('15. PolicyViolation shape has required fields', () => {
    const violation: PolicyViolation = {
      rule_id: 'test',
      description: 'desc',
      severity: 'blocking',
    };
    assert.ok('rule_id' in violation);
    assert.ok('description' in violation);
    assert.ok('severity' in violation);
    // risk_dimension is optional
    assert.equal(violation.risk_dimension, undefined);
  });
});
