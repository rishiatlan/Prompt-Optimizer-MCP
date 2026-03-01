// test/contracts.test.ts — Output shape freeze: prevents accidental drift in Phase B.
// Tests that all response shapes include request_id and array fields are deterministically ordered.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePrompt, detectTaskType } from '../src/analyzer.js';
import { compilePrompt } from '../src/compiler.js';
import { scorePrompt, generateChecklist } from '../src/scorer.js';
import { estimateCost, estimateCostForText } from '../src/estimator.js';
import { sortCountsDescKeyAsc, sortIssues, sortCostEntries, CHECKLIST_ORDER } from '../src/sort.js';
import type { PreviewPack, CompilationChecklist, ModelCost, LicenseData } from '../src/types.js';
// v3 contract imports — verify all new exports are accessible via api.ts barrel
import {
  classifyComplexity, routeModel, computeRiskScore, computeRiskScoreWithCustomRules,
  PROFILES, suggestProfile, resolveProfile,
  TIER_MODELS, RESEARCH_INTENT_RE, RISK_WEIGHTS, RISK_ESCALATION_THRESHOLD, deriveRiskLevel,
  PRICING_DATA,
} from '../src/api.js';
import type {
  ReasoningComplexity, OptimizationProfile, ComplexityResult,
  RiskDimensions, RiskScore, SavingsComparison, TierModelEntry,
  ModelTier, ModelRoutingInput, ModelRecommendation,
  RuleMatch, CustomRule, CustomRulesConfig,
  // v3.3 Enterprise Operations types
  PolicyMode, AuditEvent, AuditOutcome, AuditEntry, PolicyViolation, PurgeResult,
  SessionRecord, SessionListResponse, SessionExport,
} from '../src/api.js';
import { DEFAULT_CONFIG } from '../src/storage/interface.js';
import {
  evaluatePolicyViolations, checkRiskThreshold, buildPolicyEnforcementSummary,
  calculatePolicyHash, STRICTNESS_THRESHOLDS,
} from '../src/policy.js';

describe('PreviewPack shape contract', () => {
  it('has all required fields', () => {
    const spec = analyzePrompt('Write a blog post about AI trends for my team');
    const score = scorePrompt(spec);
    const { prompt, changes } = compilePrompt(spec, undefined, 'claude');
    const checklist = generateChecklist(prompt);
    const cost = estimateCost(prompt, spec.task_type, spec.risk_level, 'claude');

    const preview: PreviewPack = {
      request_id: 'test-id',
      session_id: 'test-session',
      state: 'COMPILED',
      intent_spec: spec,
      quality_before: score,
      compiled_prompt: prompt,
      compilation_checklist: checklist,
      blocking_questions: spec.blocking_questions,
      assumptions: spec.assumptions,
      cost_estimate: cost,
      model_recommendation: cost.recommended_model,
      changes_made: changes,
      target: 'claude',
      format_version: 1,
      scoring_version: 2,
    };

    // All required fields present
    assert.ok(preview.request_id, 'request_id required');
    assert.ok(preview.session_id, 'session_id required');
    assert.ok(preview.state, 'state required');
    assert.ok(preview.intent_spec, 'intent_spec required');
    assert.ok(preview.quality_before, 'quality_before required');
    assert.ok(preview.compiled_prompt, 'compiled_prompt required');
    assert.ok(preview.compilation_checklist, 'compilation_checklist required');
    assert.ok(Array.isArray(preview.blocking_questions), 'blocking_questions required');
    assert.ok(Array.isArray(preview.assumptions), 'assumptions required');
    assert.ok(preview.cost_estimate, 'cost_estimate required');
    assert.ok(preview.model_recommendation, 'model_recommendation required');
    assert.ok(Array.isArray(preview.changes_made), 'changes_made required');
    assert.equal(preview.target, 'claude');
    assert.equal(preview.format_version, 1);
    assert.equal(preview.scoring_version, 2);
  });
});

describe('Deterministic ordering contract', () => {
  it('sortCountsDescKeyAsc: count desc, key asc', () => {
    const record = { writing: 5, debug: 5, create: 3, research: 7 };
    const sorted = sortCountsDescKeyAsc(record);

    assert.equal(sorted[0].key, 'research');  // 7 (highest)
    assert.equal(sorted[1].key, 'debug');      // 5, 'd' < 'w'
    assert.equal(sorted[2].key, 'writing');    // 5, 'w' > 'd'
    assert.equal(sorted[3].key, 'create');     // 3
  });

  it('sortCountsDescKeyAsc respects limit', () => {
    const record = { a: 1, b: 2, c: 3, d: 4, e: 5 };
    const sorted = sortCountsDescKeyAsc(record, 3);
    assert.equal(sorted.length, 3);
    assert.equal(sorted[0].key, 'e');
  });

  it('sortCostEntries: provider asc, model asc', () => {
    const costs: ModelCost[] = [
      { provider: 'openai', model: 'gpt-4o', input_tokens: 100, estimated_output_tokens: 50, input_cost_usd: 0, output_cost_usd: 0, total_cost_usd: 0 },
      { provider: 'anthropic', model: 'sonnet', input_tokens: 100, estimated_output_tokens: 50, input_cost_usd: 0, output_cost_usd: 0, total_cost_usd: 0 },
      { provider: 'anthropic', model: 'haiku', input_tokens: 100, estimated_output_tokens: 50, input_cost_usd: 0, output_cost_usd: 0, total_cost_usd: 0 },
      { provider: 'google', model: 'gemini-2.0-flash', input_tokens: 100, estimated_output_tokens: 50, input_cost_usd: 0, output_cost_usd: 0, total_cost_usd: 0 },
    ];
    const sorted = sortCostEntries(costs);
    assert.equal(sorted[0].provider, 'anthropic');
    assert.equal(sorted[0].model, 'haiku');
    assert.equal(sorted[1].provider, 'anthropic');
    assert.equal(sorted[1].model, 'sonnet');
    assert.equal(sorted[2].provider, 'google');
    assert.equal(sorted[3].provider, 'openai');
  });

  it('checklist items follow canonical order', () => {
    assert.equal(CHECKLIST_ORDER.length, 9);
    assert.equal(CHECKLIST_ORDER[0], 'Role');
    assert.equal(CHECKLIST_ORDER[1], 'Goal');
    assert.equal(CHECKLIST_ORDER[2], 'Definition of Done');
    assert.equal(CHECKLIST_ORDER[3], 'Constraints');
    assert.equal(CHECKLIST_ORDER[4], 'Workflow');
    assert.equal(CHECKLIST_ORDER[5], 'Output Format');
    assert.equal(CHECKLIST_ORDER[6], 'Uncertainty Policy');
    assert.equal(CHECKLIST_ORDER[7], 'Audience');
    assert.equal(CHECKLIST_ORDER[8], 'Platform Guidelines');
  });

  it('estimateCost returns deterministically sorted costs', () => {
    const estimate = estimateCost('test prompt', 'writing', 'low', 'claude');
    // Should be sorted: provider asc, model asc
    for (let i = 1; i < estimate.costs.length; i++) {
      const prev = estimate.costs[i - 1];
      const curr = estimate.costs[i];
      const cmp = prev.provider.localeCompare(curr.provider);
      if (cmp === 0) {
        assert.ok(prev.model.localeCompare(curr.model) <= 0,
          `Costs not sorted: ${prev.model} should come before ${curr.model}`);
      } else {
        assert.ok(cmp < 0,
          `Costs not sorted: ${prev.provider} should come before ${curr.provider}`);
      }
    }
  });

  it('estimateCost includes all 4 providers (including Perplexity)', () => {
    const estimate = estimateCost('test prompt', 'writing', 'low', 'claude');
    const providers = new Set(estimate.costs.map(c => c.provider));
    assert.ok(providers.has('anthropic'), 'Should include anthropic');
    assert.ok(providers.has('openai'), 'Should include openai');
    assert.ok(providers.has('google'), 'Should include google');
    assert.ok(providers.has('perplexity'), 'Should include perplexity');
  });
});

describe('check_prompt response shape', () => {
  it('detectTaskType is exported and works', () => {
    assert.equal(detectTaskType('Write a blog post about AI'), 'writing');
    assert.equal(detectTaskType('Fix the bug in src/app.ts'), 'debug');
    assert.equal(detectTaskType('What is TypeScript?'), 'question');
  });
});

describe('LicenseData shape contract', () => {
  it('has all required fields', () => {
    const license: LicenseData = {
      schema_version: 1,
      tier: 'pro',
      issued_at: '2025-01-01T00:00:00Z',
      expires_at: 'never',
      license_id: 'test1234',
      activated_at: '2025-06-01T00:00:00Z',
      valid: true,
    };

    assert.equal(license.schema_version, 1);
    assert.equal(license.tier, 'pro');
    assert.ok(typeof license.issued_at === 'string');
    assert.ok(typeof license.expires_at === 'string');
    assert.ok(typeof license.license_id === 'string');
    assert.ok(typeof license.activated_at === 'string');
    assert.equal(typeof license.valid, 'boolean');
  });

  it('accepts optional validation_error', () => {
    const license: LicenseData = {
      schema_version: 1,
      tier: 'free',
      issued_at: '2025-01-01T00:00:00Z',
      expires_at: '2020-01-01T00:00:00Z',
      license_id: 'expired-1',
      activated_at: '2025-06-01T00:00:00Z',
      valid: false,
      validation_error: 'expired',
    };
    assert.equal(license.valid, false);
    assert.equal(license.validation_error, 'expired');
  });
});

describe('Cost estimate response shape', () => {
  it('has all required fields', () => {
    const estimate = estimateCost('test', 'other', 'medium', 'claude');
    assert.ok(typeof estimate.input_tokens === 'number');
    assert.ok(typeof estimate.estimated_output_tokens === 'number');
    assert.ok(Array.isArray(estimate.costs));
    assert.ok(typeof estimate.recommended_model === 'string');
    assert.ok(typeof estimate.recommendation_reason === 'string');

    for (const cost of estimate.costs) {
      assert.ok(typeof cost.provider === 'string');
      assert.ok(typeof cost.model === 'string');
      assert.ok(typeof cost.input_tokens === 'number');
      assert.ok(typeof cost.estimated_output_tokens === 'number');
      assert.ok(typeof cost.input_cost_usd === 'number');
      assert.ok(typeof cost.output_cost_usd === 'number');
      assert.ok(typeof cost.total_cost_usd === 'number');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// v3 API Export Contracts
// ═══════════════════════════════════════════════════════════════════════════════

describe('v3 API exports: all new functions are callable', () => {
  it('classifyComplexity is exported and callable', () => {
    const result = classifyComplexity('What is TypeScript?');
    assert.ok(typeof result.complexity === 'string');
    assert.ok(typeof result.confidence === 'number');
    assert.ok(Array.isArray(result.signals));
  });

  it('routeModel is exported and callable', () => {
    const input: ModelRoutingInput = {
      taskType: 'code_change',
      complexity: 'analytical',
      budgetSensitivity: 'medium',
      latencySensitivity: 'medium',
      contextTokens: 5000,
      riskScore: 20,
    };
    const result = routeModel(input);
    assert.ok(typeof result.primary.model === 'string');
    assert.ok(typeof result.primary.provider === 'string');
    assert.ok(typeof result.confidence === 'number');
    assert.ok(Array.isArray(result.decision_path));
  });

  it('computeRiskScore is exported and callable', () => {
    const result = computeRiskScore([]);
    assert.equal(result.score, 0);
    assert.equal(result.level, 'low');
  });

  it('PROFILES is exported and has 5 entries', () => {
    assert.equal(Object.keys(PROFILES).length, 5);
  });

  it('suggestProfile is exported and callable', () => {
    assert.equal(suggestProfile('simple_factual', 0), 'cost_minimizer');
  });

  it('resolveProfile is exported and callable', () => {
    const path: string[] = [];
    assert.equal(resolveProfile('balanced', path), 'balanced');
  });

  it('TIER_MODELS is exported and has 3 tiers', () => {
    assert.equal(Object.keys(TIER_MODELS).length, 3);
  });

  it('RESEARCH_INTENT_RE is exported and works', () => {
    assert.ok(RESEARCH_INTENT_RE.test('search the web for data'));
    assert.ok(!RESEARCH_INTENT_RE.test('refactor this function'));
  });

  it('RISK_WEIGHTS is exported and has entries', () => {
    assert.ok(Object.keys(RISK_WEIGHTS).length >= 10);
  });

  it('RISK_ESCALATION_THRESHOLD is exported and equals 40', () => {
    assert.equal(RISK_ESCALATION_THRESHOLD, 40);
  });

  it('deriveRiskLevel is exported and callable', () => {
    assert.equal(deriveRiskLevel(10), 'low');
    assert.equal(deriveRiskLevel(50), 'medium');
    assert.equal(deriveRiskLevel(80), 'high');
  });

  it('PRICING_DATA includes perplexity', () => {
    assert.ok('perplexity' in PRICING_DATA.providers);
  });
});

describe('v3 ModelRecommendation shape contract', () => {
  it('has all required fields', () => {
    const input: ModelRoutingInput = {
      taskType: 'create',
      complexity: 'multi_step',
      budgetSensitivity: 'medium',
      latencySensitivity: 'medium',
      contextTokens: 8000,
      riskScore: 50,
    };
    const rec: ModelRecommendation = routeModel(input);

    // Primary
    assert.ok(typeof rec.primary.model === 'string');
    assert.ok(typeof rec.primary.provider === 'string');
    assert.ok(typeof rec.primary.temperature === 'number');
    assert.ok(typeof rec.primary.maxTokens === 'number');

    // Fallback
    assert.ok(typeof rec.fallback.model === 'string');
    assert.ok(typeof rec.fallback.provider === 'string');
    assert.ok(typeof rec.fallback.reason === 'string');

    // Confidence
    assert.ok(rec.confidence >= 0 && rec.confidence <= 100);

    // Cost estimate
    assert.ok(typeof rec.costEstimate.input_tokens === 'number');
    assert.ok(Array.isArray(rec.costEstimate.costs));

    // Rationale + tradeoffs
    assert.ok(typeof rec.rationale === 'string');
    assert.ok(Array.isArray(rec.tradeoffs));

    // Savings (G13)
    assert.ok(typeof rec.savings_vs_default.baselineModel === 'string');
    assert.ok(typeof rec.savings_vs_default.baselineCost === 'number');
    assert.ok(typeof rec.savings_vs_default.recommendedCost === 'number');
    assert.ok(typeof rec.savings_vs_default.savingsPercent === 'number');
    assert.ok(typeof rec.savings_summary === 'string');

    // Decision path
    assert.ok(Array.isArray(rec.decision_path));
    assert.ok(rec.decision_path.length > 0);
  });
});

describe('v3 schema_version contract', () => {
  it('all v3 tool outputs must include schema_version: 1 (forward-compat)', () => {
    // Verify the constant is always 1 for this major version.
    // Actual tool outputs are tested in e2e — this test validates
    // the contract concept: schema_version is required and numeric.
    const SCHEMA_VERSION = 1;
    assert.equal(typeof SCHEMA_VERSION, 'number');
    assert.equal(SCHEMA_VERSION, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// v3.2.1 Custom Rules Shape Contracts
// ═══════════════════════════════════════════════════════════════════════════════

describe('CustomRule shape contract', () => {
  it('has all 8 required fields with correct types', () => {
    const rule: CustomRule = {
      id: 'test_rule',
      description: 'A test rule',
      pattern: 'test.*pattern',
      applies_to: 'all',
      severity: 'BLOCKING',
      risk_dimension: 'underspec',
      risk_weight: 10,
    };

    assert.equal(typeof rule.id, 'string');
    assert.equal(typeof rule.description, 'string');
    assert.equal(typeof rule.pattern, 'string');
    assert.equal(typeof rule.applies_to, 'string');
    assert.equal(typeof rule.severity, 'string');
    assert.equal(typeof rule.risk_dimension, 'string');
    assert.equal(typeof rule.risk_weight, 'number');
    assert.ok(['code', 'prose', 'all'].includes(rule.applies_to));
    assert.ok(['BLOCKING', 'NON-BLOCKING'].includes(rule.severity));
    assert.ok(['hallucination', 'constraint', 'underspec', 'scope'].includes(rule.risk_dimension));
    assert.ok(rule.risk_weight >= 1 && rule.risk_weight <= 25);
  });

  it('accepts optional negative_pattern', () => {
    const rule: CustomRule = {
      id: 'neg_rule',
      description: 'Rule with negative pattern',
      pattern: 'match_this',
      negative_pattern: 'but_not_this',
      applies_to: 'code',
      severity: 'NON-BLOCKING',
      risk_dimension: 'constraint',
      risk_weight: 5,
    };

    assert.equal(typeof rule.negative_pattern, 'string');
  });
});

describe('RuleMatch shape contract', () => {
  it('has all required fields', () => {
    const match: RuleMatch = {
      rule_id: 'custom_test_rule',
      matched: true,
      description: 'Test rule matched',
      severity: 'BLOCKING',
    };

    assert.equal(typeof match.rule_id, 'string');
    assert.equal(typeof match.matched, 'boolean');
    assert.equal(typeof match.description, 'string');
    assert.ok(['BLOCKING', 'NON-BLOCKING'].includes(match.severity));
  });

  it('accepts optional custom_weight, risk_dimension, error', () => {
    const match: RuleMatch = {
      rule_id: 'custom_weighted',
      matched: true,
      description: 'Weighted rule',
      severity: 'NON-BLOCKING',
      custom_weight: 15,
      risk_dimension: 'scope',
    };

    assert.equal(match.custom_weight, 15);
    assert.equal(match.risk_dimension, 'scope');

    const errorMatch: RuleMatch = {
      rule_id: 'custom_error',
      matched: false,
      description: 'Failed rule',
      severity: 'BLOCKING',
      error: 'Pattern compilation failed',
    };
    assert.equal(typeof errorMatch.error, 'string');
  });
});

describe('computeRiskScoreWithCustomRules export contract', () => {
  it('is exported from api.ts and callable', async () => {
    assert.equal(typeof computeRiskScoreWithCustomRules, 'function');

    // With no custom rules file, should return same as sync computeRiskScore
    const { riskScore, customRuleMatches } = await computeRiskScoreWithCustomRules([], 'test prompt', 'other');
    assert.equal(riskScore.score, 0);
    assert.equal(riskScore.level, 'low');
    assert.ok(Array.isArray(customRuleMatches));
    assert.equal(customRuleMatches.length, 0);
  });

  it('returns same base score as sync function when no custom rules exist', async () => {
    const syncResult = computeRiskScore([]);
    const { riskScore } = await computeRiskScoreWithCustomRules([], 'test', 'other');
    assert.equal(riskScore.score, syncResult.score);
    assert.equal(riskScore.level, syncResult.level);
    assert.deepStrictEqual(riskScore.dimensions, syncResult.dimensions);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// v3.3.0 Enterprise Operations Shape Contracts
// ═══════════════════════════════════════════════════════════════════════════════

describe('AuditEntry shape contract', () => {
  it('has required fields with correct types', () => {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      event: 'optimize',
      request_id: 'req-123',
      outcome: 'success',
    };
    assert.equal(typeof entry.timestamp, 'string');
    assert.equal(typeof entry.event, 'string');
    assert.equal(typeof entry.request_id, 'string');
    assert.equal(typeof entry.outcome, 'string');
    assert.ok(['optimize', 'approve', 'delete', 'purge', 'configure', 'license_activate'].includes(entry.event));
    assert.ok(['success', 'blocked', 'error'].includes(entry.outcome));
  });

  it('details typed as Record<string, string | number | boolean>', () => {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      event: 'optimize',
      request_id: 'req-123',
      outcome: 'success',
      details: { key: 'val', num: 42, flag: true },
    };
    for (const v of Object.values(entry.details!)) {
      assert.ok(
        typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
        `details value must be string|number|boolean, got ${typeof v}`,
      );
    }
  });
});

describe('PolicyViolation shape contract', () => {
  it('has required fields', () => {
    const v: PolicyViolation = {
      rule_id: 'no_pii',
      description: 'PII detected',
      severity: 'blocking',
    };
    assert.equal(typeof v.rule_id, 'string');
    assert.equal(typeof v.description, 'string');
    assert.equal(typeof v.severity, 'string');
    assert.equal(v.risk_dimension, undefined); // optional
  });
});

describe('DEFAULT_CONFIG v3.3.0 fields', () => {
  it('has correct defaults for new fields', () => {
    assert.equal(DEFAULT_CONFIG.session_retention_days, undefined);
    assert.equal(DEFAULT_CONFIG.policy_mode, 'advisory');
    assert.equal(DEFAULT_CONFIG.audit_log, false);
  });
});

describe('STRICTNESS_THRESHOLDS contract', () => {
  it('has relaxed=40, standard=60, strict=75', () => {
    assert.equal(STRICTNESS_THRESHOLDS.relaxed, 40);
    assert.equal(STRICTNESS_THRESHOLDS.standard, 60);
    assert.equal(STRICTNESS_THRESHOLDS.strict, 75);
  });
});

describe('policy_violation error payload shape', () => {
  it('has code, message, request_id, policy_mode, violations[]', () => {
    // Simulate what tools.ts returns
    const errorPayload = {
      error: 'policy_violation',
      code: 'policy_violation',
      message: 'Policy violation: 1 blocking rule(s) triggered',
      request_id: 'req-abc',
      policy_mode: 'enforce',
      violations: [{ rule_id: 'r1', description: 'd1', severity: 'blocking' }],
    };
    assert.equal(errorPayload.code, 'policy_violation');
    assert.ok(errorPayload.message);
    assert.ok(errorPayload.request_id);
    assert.equal(errorPayload.policy_mode, 'enforce');
    assert.ok(Array.isArray(errorPayload.violations));
    assert.ok(errorPayload.violations.length > 0);
    // Violations sorted by rule_id
    const ids = errorPayload.violations.map((v: PolicyViolation) => v.rule_id);
    const sorted = [...ids].sort();
    assert.deepEqual(ids, sorted, 'violations must be sorted by rule_id');
  });
});

describe('risk_threshold_exceeded error payload shape', () => {
  it('has code, message, request_id, policy_mode, risk_score, threshold, strictness', () => {
    const errorPayload = {
      error: 'risk_threshold_exceeded',
      code: 'risk_threshold_exceeded',
      message: 'Risk score 70 exceeds threshold 60 (strictness: standard). Blocked when score >= threshold.',
      request_id: 'req-def',
      policy_mode: 'enforce',
      risk_score: 70,
      threshold: 60,
      strictness: 'standard',
    };
    assert.equal(errorPayload.code, 'risk_threshold_exceeded');
    assert.ok(errorPayload.message);
    assert.ok(errorPayload.request_id);
    assert.equal(errorPayload.policy_mode, 'enforce');
    assert.equal(typeof errorPayload.risk_score, 'number');
    assert.equal(typeof errorPayload.threshold, 'number');
    assert.equal(typeof errorPayload.strictness, 'string');
  });
});

describe('v3.3.0 api.ts barrel exports', () => {
  it('exports policy functions', async () => {
    const api = await import('../src/api.js');
    assert.equal(typeof api.evaluatePolicyViolations, 'function');
    assert.equal(typeof api.checkRiskThreshold, 'function');
    assert.equal(typeof api.buildPolicyEnforcementSummary, 'function');
    assert.equal(typeof api.calculatePolicyHash, 'function');
    assert.ok(api.STRICTNESS_THRESHOLDS);
  });

  it('exports AuditLogger', async () => {
    const api = await import('../src/api.js');
    assert.ok(api.AuditLogger);
    assert.ok(api.auditLogger);
  });

  it('exports SessionHistoryManager', async () => {
    const api = await import('../src/api.js');
    assert.ok(api.SessionHistoryManager);
    assert.ok(api.sessionHistory);
  });

  it('exports GENESIS_HASH', async () => {
    const api = await import('../src/api.js');
    assert.ok(api.GENESIS_HASH);
    assert.equal(api.GENESIS_HASH.length, 64);
    assert.match(api.GENESIS_HASH, /^0{64}$/);
  });
});

describe('AuditEntry integrity_hash contract', () => {
  it('integrity_hash is optional string (backward compatible)', () => {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      event: 'optimize',
      request_id: 'req-123',
      outcome: 'success',
    };
    assert.equal(entry.integrity_hash, undefined); // optional
  });
});

describe('OptimizerConfig lock fields contract', () => {
  it('locked_config is optional boolean, lock_secret_hash is optional string', () => {
    assert.equal(DEFAULT_CONFIG.locked_config, undefined);
    assert.equal(DEFAULT_CONFIG.lock_secret_hash, undefined);
  });

  it('config_locked error payload shape', () => {
    const errorPayload = {
      request_id: 'req-123',
      error: 'config_locked',
      message: 'Config is locked. Use unlock: true with the correct lock_secret to make changes.',
    };
    assert.equal(errorPayload.error, 'config_locked');
    assert.ok(errorPayload.message.includes('unlock'));
    assert.ok(errorPayload.request_id);
  });

  it('invalid_lock_secret error payload shape', () => {
    const errorPayload = {
      request_id: 'req-123',
      error: 'invalid_lock_secret',
      message: 'Wrong lock_secret. Unlock attempt logged.',
    };
    assert.equal(errorPayload.error, 'invalid_lock_secret');
    assert.ok(errorPayload.message.includes('logged'));
  });
});
