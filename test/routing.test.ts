// test/routing.test.ts — Model routing: TIER_MODELS, routeModel(), determinism,
// research intent, savings, decision_path audit, profile overrides, budget/latency.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  routeModel,
  TIER_MODELS,
  RESEARCH_INTENT_RE,
  PRICING_DATA,
  estimateTokens,
} from '../src/estimator.js';
import { RISK_ESCALATION_THRESHOLD } from '../src/rules.js';
import type {
  ModelRoutingInput,
  ModelRecommendation,
  ModelTier,
  TierModelEntry,
} from '../src/types.js';

// ─── Helper: minimal routing input ──────────────────────────────────────────

function makeInput(overrides: Partial<ModelRoutingInput> = {}): ModelRoutingInput {
  return {
    taskType: 'code_change',
    complexity: 'analytical',
    budgetSensitivity: 'medium',
    latencySensitivity: 'medium',
    contextTokens: 5000,
    riskScore: 20,
    ...overrides,
  };
}

// ─── TIER_MODELS constant (G1) ──────────────────────────────────────────────

describe('TIER_MODELS (G1)', () => {
  it('has exactly 3 tiers: small, mid, top', () => {
    const tiers = Object.keys(TIER_MODELS);
    assert.deepEqual(tiers.sort(), ['mid', 'small', 'top']);
  });

  it('each tier has 4 providers (anthropic, openai, google, perplexity)', () => {
    for (const tier of ['small', 'mid', 'top'] as ModelTier[]) {
      const providers = TIER_MODELS[tier].map(e => e.provider).sort();
      assert.deepEqual(providers, ['anthropic', 'google', 'openai', 'perplexity'],
        `Tier ${tier} missing a provider`);
    }
  });

  it('all entries have valid fields', () => {
    for (const [tier, entries] of Object.entries(TIER_MODELS)) {
      for (const entry of entries) {
        assert.ok(typeof entry.provider === 'string' && entry.provider.length > 0,
          `${tier}: provider must be non-empty string`);
        assert.ok(typeof entry.model === 'string' && entry.model.length > 0,
          `${tier}: model must be non-empty string`);
        assert.ok(typeof entry.defaultTemp === 'number' && entry.defaultTemp >= 0 && entry.defaultTemp <= 1,
          `${tier}: defaultTemp must be 0-1`);
        assert.ok(typeof entry.maxTokensCap === 'number' && entry.maxTokensCap > 0,
          `${tier}: maxTokensCap must be positive`);
      }
    }
  });

  it('TIER_MODELS is frozen (immutable)', () => {
    assert.ok(Object.isFrozen(TIER_MODELS), 'TIER_MODELS should be frozen');
    for (const tier of ['small', 'mid', 'top'] as ModelTier[]) {
      assert.ok(Object.isFrozen(TIER_MODELS[tier]), `TIER_MODELS.${tier} should be frozen`);
      for (const entry of TIER_MODELS[tier]) {
        assert.ok(Object.isFrozen(entry), `Each entry in TIER_MODELS.${tier} should be frozen`);
      }
    }
  });

  it('all models referenced in TIER_MODELS exist in PRICING_DATA', () => {
    for (const [tier, entries] of Object.entries(TIER_MODELS)) {
      for (const entry of entries) {
        const providerPricing = (PRICING_DATA.providers as Record<string, Record<string, unknown>>)[entry.provider];
        assert.ok(providerPricing, `${tier}: provider '${entry.provider}' not in PRICING_DATA`);
        assert.ok(providerPricing[entry.model], `${tier}: model '${entry.model}' not in PRICING_DATA.providers.${entry.provider}`);
      }
    }
  });
});

// ─── PRICING_DATA: Perplexity added ─────────────────────────────────────────

describe('PRICING_DATA: Perplexity', () => {
  it('has perplexity provider', () => {
    assert.ok('perplexity' in PRICING_DATA.providers, 'perplexity must be in PRICING_DATA');
  });

  it('perplexity has sonar and sonar-pro', () => {
    const pp = PRICING_DATA.providers.perplexity;
    assert.ok('sonar' in pp, 'sonar must be in perplexity');
    assert.ok('sonar-pro' in pp, 'sonar-pro must be in perplexity');
  });

  it('all pricing values are per 1M tokens (G10: positive numbers)', () => {
    for (const [provName, models] of Object.entries(PRICING_DATA.providers)) {
      for (const [modelName, pricing] of Object.entries(models)) {
        assert.ok(
          (pricing as { in: number }).in > 0,
          `${provName}/${modelName}: input rate must be positive`,
        );
        assert.ok(
          (pricing as { out: number }).out > 0,
          `${provName}/${modelName}: output rate must be positive`,
        );
      }
    }
  });
});

// ─── Routing: Complexity → Tier mapping ─────────────────────────────────────

describe('routeModel: complexity → tier mapping', () => {
  it('simple_factual → small tier', () => {
    const result = routeModel(makeInput({ complexity: 'simple_factual', riskScore: 10 }));
    assert.ok(result.decision_path.includes('default_tier=small'));
  });

  it('analytical → mid tier', () => {
    const result = routeModel(makeInput({ complexity: 'analytical', riskScore: 10 }));
    assert.ok(result.decision_path.includes('default_tier=mid'));
  });

  it('multi_step + high risk → top tier', () => {
    const result = routeModel(makeInput({
      complexity: 'multi_step',
      riskScore: RISK_ESCALATION_THRESHOLD,
    }));
    assert.ok(result.decision_path.includes('default_tier=top'));
  });

  it('multi_step + low risk → mid tier', () => {
    const result = routeModel(makeInput({
      complexity: 'multi_step',
      riskScore: RISK_ESCALATION_THRESHOLD - 1,
    }));
    assert.ok(result.decision_path.includes('default_tier=mid'));
  });

  it('creative → mid tier', () => {
    const result = routeModel(makeInput({ complexity: 'creative', riskScore: 10 }));
    assert.ok(result.decision_path.includes('default_tier=mid'));
  });

  it('long_context → mid tier', () => {
    const result = routeModel(makeInput({ complexity: 'long_context', riskScore: 10 }));
    assert.ok(result.decision_path.includes('default_tier=mid'));
  });

  it('agent_orchestration + high risk → top tier', () => {
    const result = routeModel(makeInput({
      complexity: 'agent_orchestration',
      riskScore: RISK_ESCALATION_THRESHOLD,
    }));
    assert.ok(result.decision_path.includes('default_tier=top'));
  });

  it('agent_orchestration + low risk → mid tier', () => {
    const result = routeModel(makeInput({
      complexity: 'agent_orchestration',
      riskScore: RISK_ESCALATION_THRESHOLD - 1,
    }));
    assert.ok(result.decision_path.includes('default_tier=mid'));
  });
});

// ─── Routing: Budget/Latency overrides (Step 2) ─────────────────────────────

describe('routeModel: budget/latency overrides', () => {
  it('budgetSensitivity=high downgrades top → mid', () => {
    const result = routeModel(makeInput({
      complexity: 'multi_step',
      riskScore: RISK_ESCALATION_THRESHOLD,  // would be top tier
      budgetSensitivity: 'high',
    }));
    assert.ok(result.decision_path.some(e => e.includes('budget_override=downgrade_top→mid')));
  });

  it('budgetSensitivity=high downgrades mid → small', () => {
    const result = routeModel(makeInput({
      complexity: 'analytical',
      riskScore: 10,  // would be mid tier
      budgetSensitivity: 'high',
    }));
    assert.ok(result.decision_path.some(e => e.includes('budget_override=downgrade_mid→small')));
  });

  it('latencySensitivity=high downgrades top → mid', () => {
    const result = routeModel(makeInput({
      complexity: 'multi_step',
      riskScore: RISK_ESCALATION_THRESHOLD,  // top tier
      latencySensitivity: 'high',
    }));
    assert.ok(result.decision_path.some(e => e.includes('latency_override=downgrade_top→mid')));
  });

  it('small context + simple_factual forces small tier', () => {
    const result = routeModel(makeInput({
      complexity: 'simple_factual',
      riskScore: 60,           // elevated risk → would normally push up
      contextTokens: 500,
    }));
    // simple_factual already starts at small, so no override
    assert.ok(result.decision_path.includes('default_tier=small'));
  });
});

// ─── Routing: Target-aware provider selection ───────────────────────────────

describe('routeModel: target-aware provider selection', () => {
  it('claude target → anthropic provider', () => {
    const result = routeModel(makeInput(), undefined, 60, 'claude');
    assert.equal(result.primary.provider, 'anthropic');
  });

  it('openai target → openai provider', () => {
    const result = routeModel(makeInput(), undefined, 60, 'openai');
    assert.equal(result.primary.provider, 'openai');
  });

  it('generic target → anthropic provider (default)', () => {
    const result = routeModel(makeInput(), undefined, 60, 'generic');
    assert.equal(result.primary.provider, 'anthropic');
  });
});

// ─── Routing: Fallback model ────────────────────────────────────────────────

describe('routeModel: fallback model', () => {
  it('fallback provider differs from primary', () => {
    const result = routeModel(makeInput());
    assert.notEqual(result.primary.provider, result.fallback.provider);
  });

  it('fallback has reason string', () => {
    const result = routeModel(makeInput());
    assert.ok(result.fallback.reason.length > 0);
  });
});

// ─── Routing: Profile overrides ─────────────────────────────────────────────

describe('routeModel: profile overrides', () => {
  it('cost_minimizer profile forces budget=high default', () => {
    // Explicitly pass undefined for budgetSensitivity so profile default (high) applies
    const input: ModelRoutingInput = {
      taskType: 'code_change',
      complexity: 'analytical',
      budgetSensitivity: undefined as unknown as 'low' | 'medium' | 'high',
      latencySensitivity: 'medium',
      contextTokens: 5000,
      riskScore: 10,
      profile: 'cost_minimizer',
    };
    const result = routeModel(input);
    // cost_minimizer has budgetSensitivity='high', which downgrades mid → small
    assert.ok(result.decision_path.some(e => e.includes('budget_override')));
  });

  it('explicit budgetSensitivity overrides profile default', () => {
    // cost_minimizer has budget=high, but explicit low should win
    const result = routeModel(makeInput({
      complexity: 'analytical',
      riskScore: 10,
      profile: 'cost_minimizer',
      budgetSensitivity: 'low',
    }));
    // With explicit budget=low, no budget override should apply
    assert.ok(!result.decision_path.some(e => e.includes('budget_override')));
  });

  it('invalid profile → balanced + fallback in decision_path', () => {
    const result = routeModel(makeInput({ profile: 'turbo_mode' as any }));
    assert.ok(result.decision_path.some(e => e.includes('profile_fallback=turbo_mode→balanced')));
    assert.ok(result.decision_path.includes('profile=balanced'));
  });

  it('enterprise_safe profile uses top tier temperature 0.1', () => {
    const result = routeModel(makeInput({
      complexity: 'analytical',
      riskScore: 10,
      profile: 'enterprise_safe',
    }));
    assert.equal(result.primary.temperature, 0.1);
  });

  it('creative profile uses temperature 0.9', () => {
    const result = routeModel(makeInput({
      complexity: 'creative',
      riskScore: 10,
      profile: 'creative',
    }));
    assert.equal(result.primary.temperature, 0.9);
  });
});

// ─── Research Intent Regex (G15) ────────────────────────────────────────────

describe('RESEARCH_INTENT_RE (G15)', () => {
  // Positive matches
  it('matches "search the web"', () => {
    assert.ok(RESEARCH_INTENT_RE.test('Please search the web for React performance tips'));
  });

  it('matches "look up"', () => {
    assert.ok(RESEARCH_INTENT_RE.test('Look up the latest TypeScript release notes'));
  });

  it('matches "with citations"', () => {
    assert.ok(RESEARCH_INTENT_RE.test('Explain quantum computing with citations'));
  });

  it('matches "with sources"', () => {
    assert.ok(RESEARCH_INTENT_RE.test('Write a summary of AI trends with sources'));
  });

  it('matches "current news"', () => {
    assert.ok(RESEARCH_INTENT_RE.test('What is the current news about climate change?'));
  });

  it('matches "browse"', () => {
    assert.ok(RESEARCH_INTENT_RE.test('Browse for information about Rust vs Go'));
  });

  // Negative matches (false positives that must NOT trigger)
  it('does NOT match "latest version of Node"', () => {
    assert.ok(!RESEARCH_INTENT_RE.test('What is the latest version of Node?'));
  });

  it('does NOT match simple code prompt', () => {
    assert.ok(!RESEARCH_INTENT_RE.test('Refactor this function to use async/await'));
  });

  it('does NOT match "look" without "up"', () => {
    assert.ok(!RESEARCH_INTENT_RE.test('Look at this code and fix the bug'));
  });

  it('does NOT match "current" alone', () => {
    assert.ok(!RESEARCH_INTENT_RE.test('Return the current user object'));
  });
});

// ─── Routing: Research intent → Perplexity ──────────────────────────────────

describe('routeModel: research intent routing', () => {
  it('research intent prompt → Perplexity recommended', () => {
    const result = routeModel(
      makeInput({ complexity: 'analytical' }),
      'Search the web for the latest React performance benchmarks',
    );
    assert.equal(result.primary.provider, 'perplexity');
    assert.ok(result.decision_path.includes('research_intent=true'));
  });

  it('non-research prompt → no Perplexity', () => {
    const result = routeModel(
      makeInput({ complexity: 'analytical' }),
      'Refactor this TypeScript function to use generics',
    );
    assert.notEqual(result.primary.provider, 'perplexity');
    assert.ok(!result.decision_path.includes('research_intent=true'));
  });

  it('no promptText → no research intent', () => {
    const result = routeModel(makeInput({ complexity: 'analytical' }));
    assert.notEqual(result.primary.provider, 'perplexity');
    assert.ok(!result.decision_path.includes('research_intent=true'));
  });
});

// ─── Confidence formula (G3) ────────────────────────────────────────────────

describe('routeModel: confidence formula (G3)', () => {
  it('base confidence is 60', () => {
    // Default: complexityConfidence=60, riskScore=20 (<20: +10), no overrides, no research
    const result = routeModel(makeInput({ riskScore: 20 }), undefined, 60);
    // 60 + 0 (confidence=60, not ≥80) + 0 (risk=20, not <20) = 60
    assert.equal(result.confidence, 60);
  });

  it('high complexity confidence → +10', () => {
    const result = routeModel(makeInput({ riskScore: 25 }), undefined, 85);
    // 60 + 10 (≥80) + 0 (risk=25, not <20) = 70
    assert.equal(result.confidence, 70);
  });

  it('low risk → +10', () => {
    const result = routeModel(makeInput({ riskScore: 10 }), undefined, 60);
    // 60 + 0 + 10 (risk<20) = 70
    assert.equal(result.confidence, 70);
  });

  it('high complexity + low risk → 80', () => {
    const result = routeModel(makeInput({ riskScore: 10 }), undefined, 90);
    // 60 + 10 + 10 = 80
    assert.equal(result.confidence, 80);
  });

  it('overrides applied → -10', () => {
    // Force a budget override: analytical (mid tier) + budget=high → downgrade to small
    const result = routeModel(
      makeInput({ complexity: 'analytical', riskScore: 10, budgetSensitivity: 'high' }),
      undefined, 60,
    );
    // 60 + 0 + 10 (risk<20) - 10 (override) = 60
    assert.equal(result.confidence, 60);
  });

  it('research intent → -10', () => {
    const result = routeModel(
      makeInput({ riskScore: 10 }),
      'Search the web for TypeScript best practices',
      60,
    );
    // 60 + 0 + 10 (risk<20) - 10 (research) = 60
    assert.equal(result.confidence, 60);
  });
});

// ─── Savings vs Default (G2, G13) ───────────────────────────────────────────

describe('routeModel: savings_vs_default (G2, G13)', () => {
  it('savings_vs_default has all required fields', () => {
    const result = routeModel(makeInput());
    assert.ok('baselineModel' in result.savings_vs_default);
    assert.ok('baselineCost' in result.savings_vs_default);
    assert.ok('recommendedCost' in result.savings_vs_default);
    assert.ok('savingsPercent' in result.savings_vs_default);
  });

  it('baseline model is gpt-4o', () => {
    const result = routeModel(makeInput());
    assert.equal(result.savings_vs_default.baselineModel, 'gpt-4o');
  });

  it('decision_path includes baseline_model=gpt-4o', () => {
    const result = routeModel(makeInput());
    assert.ok(result.decision_path.includes('baseline_model=gpt-4o'));
  });

  it('savingsPercent is non-negative', () => {
    const result = routeModel(makeInput());
    assert.ok(result.savings_vs_default.savingsPercent >= 0);
  });

  it('small tier model is cheaper than baseline', () => {
    const result = routeModel(makeInput({
      complexity: 'simple_factual',
      riskScore: 5,
      contextTokens: 1000,
    }));
    assert.ok(result.savings_vs_default.savingsPercent > 0,
      'Small tier should be cheaper than gpt-4o baseline');
  });

  it('savings_summary contains percentage or comparable', () => {
    const result = routeModel(makeInput());
    assert.ok(
      result.savings_summary.includes('%') || result.savings_summary.includes('Comparable'),
      'savings_summary should contain % or Comparable',
    );
  });
});

// ─── Decision Path (audit trail) ────────────────────────────────────────────

describe('routeModel: decision_path audit trail', () => {
  it('decision_path is a non-empty array', () => {
    const result = routeModel(makeInput());
    assert.ok(Array.isArray(result.decision_path));
    assert.ok(result.decision_path.length > 0);
  });

  it('decision_path contains complexity', () => {
    const result = routeModel(makeInput({ complexity: 'multi_step' }));
    assert.ok(result.decision_path.includes('complexity=multi_step'));
  });

  it('decision_path contains risk_score', () => {
    const result = routeModel(makeInput({ riskScore: 42 }));
    assert.ok(result.decision_path.includes('risk_score=42'));
  });

  it('decision_path contains profile', () => {
    const result = routeModel(makeInput({ profile: 'quality_first' }));
    assert.ok(result.decision_path.includes('profile=quality_first'));
  });

  it('decision_path contains selected model', () => {
    const result = routeModel(makeInput());
    assert.ok(result.decision_path.some(e => e.startsWith('selected=')));
  });

  it('decision_path contains fallback model', () => {
    const result = routeModel(makeInput());
    assert.ok(result.decision_path.some(e => e.startsWith('fallback=')));
  });

  it('decision_path contains baseline_model', () => {
    const result = routeModel(makeInput());
    assert.ok(result.decision_path.includes('baseline_model=gpt-4o'));
  });
});

// ─── Cost Estimate ──────────────────────────────────────────────────────────

describe('routeModel: costEstimate', () => {
  it('costEstimate includes all 4 providers', () => {
    const result = routeModel(makeInput());
    const providers = [...new Set(result.costEstimate.costs.map(c => c.provider))];
    assert.ok(providers.includes('anthropic'));
    assert.ok(providers.includes('openai'));
    assert.ok(providers.includes('google'));
    assert.ok(providers.includes('perplexity'));
  });

  it('costEstimate.recommended_model matches primary.model', () => {
    const result = routeModel(makeInput());
    assert.equal(result.costEstimate.recommended_model, result.primary.model);
  });
});

// ─── Determinism ────────────────────────────────────────────────────────────

describe('routeModel: determinism', () => {
  it('same input → same output', () => {
    const input = makeInput({ complexity: 'multi_step', riskScore: 50 });
    const r1 = routeModel(input, 'Search the web for data', 75, 'claude');
    const r2 = routeModel(input, 'Search the web for data', 75, 'claude');
    assert.deepEqual(r1, r2);
  });

  it('same input → same decision_path', () => {
    const input = makeInput({ complexity: 'creative', profile: 'creative' });
    const r1 = routeModel(input);
    const r2 = routeModel(input);
    assert.deepEqual(r1.decision_path, r2.decision_path);
  });

  it('same input → same confidence', () => {
    const input = makeInput({ riskScore: 10 });
    const r1 = routeModel(input, undefined, 85);
    const r2 = routeModel(input, undefined, 85);
    assert.equal(r1.confidence, r2.confidence);
  });
});

// ─── Tradeoffs ──────────────────────────────────────────────────────────────

describe('routeModel: tradeoffs', () => {
  it('tradeoffs is a non-empty array', () => {
    const result = routeModel(makeInput());
    assert.ok(Array.isArray(result.tradeoffs));
    assert.ok(result.tradeoffs.length > 0);
  });

  it('budget=high → tradeoff mentions budget', () => {
    const result = routeModel(makeInput({ budgetSensitivity: 'high' }));
    assert.ok(result.tradeoffs.some(t => t.toLowerCase().includes('budget')));
  });

  it('research intent → tradeoff mentions Perplexity', () => {
    const result = routeModel(
      makeInput(),
      'Browse for information about Rust async runtime',
    );
    assert.ok(result.tradeoffs.some(t => t.toLowerCase().includes('perplexity')));
  });
});

// ─── Rationale ──────────────────────────────────────────────────────────────

describe('routeModel: rationale', () => {
  it('rationale is a non-empty string', () => {
    const result = routeModel(makeInput());
    assert.ok(result.rationale.length > 0);
  });

  it('rationale contains complexity type', () => {
    const result = routeModel(makeInput({ complexity: 'agent_orchestration' }));
    assert.ok(result.rationale.includes('agent_orchestration'));
  });

  it('rationale contains profile name', () => {
    const result = routeModel(makeInput({ profile: 'enterprise_safe' }));
    assert.ok(result.rationale.includes('enterprise_safe'));
  });
});
