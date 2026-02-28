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
  classifyComplexity, routeModel, computeRiskScore,
  PROFILES, suggestProfile, resolveProfile,
  TIER_MODELS, RESEARCH_INTENT_RE, RISK_WEIGHTS, RISK_ESCALATION_THRESHOLD, deriveRiskLevel,
  PRICING_DATA,
} from '../src/api.js';
import type {
  ReasoningComplexity, OptimizationProfile, ComplexityResult,
  RiskDimensions, RiskScore, SavingsComparison, TierModelEntry,
  ModelTier, ModelRoutingInput, ModelRecommendation,
} from '../src/api.js';

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
