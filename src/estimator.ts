// estimator.ts — Token counting, multi-provider cost estimation, and model recommendation.
// Supports Anthropic, OpenAI, and Google models. Target-aware recommendations.

import type {
  CostEstimate, ModelCost, TaskType, RiskLevel, OutputTarget,
  ModelRoutingInput, ModelRecommendation, TierModelEntry, ModelTier, SavingsComparison,
} from './types.js';
import { sortCostEntries } from './sort.js';
import { RISK_ESCALATION_THRESHOLD, deriveRiskLevel } from './rules.js';
import { PROFILES, resolveProfile } from './profiles.js';

// ─── Pricing (per 1M tokens) ─────────────────────────────────────────────────

export const PRICING_DATA = {
  pricing_version: '2026-02',
  last_updated: '2026-02-27',
  providers: {
    anthropic: {
      haiku:  { in: 0.80,  out: 4.00  },
      sonnet: { in: 3.00,  out: 15.00 },
      opus:   { in: 15.00, out: 75.00 },
    },
    openai: {
      'gpt-4o-mini': { in: 0.15,  out: 0.60  },
      'gpt-4o':      { in: 2.50,  out: 10.00 },
      'o1':          { in: 15.00, out: 60.00 },
    },
    google: {
      'gemini-2.0-flash': { in: 0.10, out: 0.40 },
      'gemini-2.0-pro':   { in: 1.25, out: 5.00 },
    },
    perplexity: {
      'sonar':     { in: 1.00, out: 1.00  },
      'sonar-pro': { in: 3.00, out: 15.00 },
    },
  },
} as const;

type Provider = keyof typeof PRICING_DATA.providers;

// ─── TIER_MODELS (G1: explicit tier-to-model mapping) ────────────────────────

export const TIER_MODELS: Readonly<Record<ModelTier, readonly TierModelEntry[]>> = Object.freeze({
  small: Object.freeze([
    Object.freeze({ provider: 'anthropic',  model: 'haiku',            defaultTemp: 0.3, maxTokensCap: 2000  }),
    Object.freeze({ provider: 'openai',     model: 'gpt-4o-mini',     defaultTemp: 0.3, maxTokensCap: 2000  }),
    Object.freeze({ provider: 'google',     model: 'gemini-2.0-flash', defaultTemp: 0.3, maxTokensCap: 2000  }),
    Object.freeze({ provider: 'perplexity', model: 'sonar',           defaultTemp: 0.3, maxTokensCap: 2000  }),
  ]),
  mid: Object.freeze([
    Object.freeze({ provider: 'anthropic',  model: 'sonnet',          defaultTemp: 0.5, maxTokensCap: 4000  }),
    Object.freeze({ provider: 'openai',     model: 'gpt-4o',         defaultTemp: 0.5, maxTokensCap: 4000  }),
    Object.freeze({ provider: 'google',     model: 'gemini-2.0-pro',  defaultTemp: 0.5, maxTokensCap: 4000  }),
    Object.freeze({ provider: 'perplexity', model: 'sonar-pro',      defaultTemp: 0.5, maxTokensCap: 4000  }),
  ]),
  top: Object.freeze([
    Object.freeze({ provider: 'anthropic',  model: 'opus',            defaultTemp: 0.3, maxTokensCap: 8000  }),
    Object.freeze({ provider: 'openai',     model: 'o1',             defaultTemp: 0.3, maxTokensCap: 8000  }),
    Object.freeze({ provider: 'google',     model: 'gemini-2.0-pro',  defaultTemp: 0.3, maxTokensCap: 8000  }),
    Object.freeze({ provider: 'perplexity', model: 'sonar-pro',      defaultTemp: 0.3, maxTokensCap: 8000  }),
  ]),
});

// ─── Research Intent Regex (G15: strict, word-boundary, tested for false positives) ─

export const RESEARCH_INTENT_RE = /\b(?:browse|search\s+the\s+web|look\s+up|with\s+citations|with\s+sources|with\s+links|current\s+(?:news|events|data)|today['']?s\s+(?:news|headlines))\b/i;

// ─── Baseline Model for Savings (G2) ────────────────────────────────────────

const BASELINE_MODEL = 'gpt-4o';
const BASELINE_IN_RATE = 2.50;   // per 1M tokens
const BASELINE_OUT_RATE = 10.00; // per 1M tokens

// ─── Token Estimation ─────────────────────────────────────────────────────────

/** Approximate token count. ~4 chars per token for English text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimate output tokens based on task type and input size. */
function estimateOutputTokens(inputTokens: number, taskType: TaskType): number {
  switch (taskType) {
    // Code tasks
    case 'question':
      return Math.min(inputTokens, 500);
    case 'review':
      return Math.min(Math.ceil(inputTokens * 0.5), 2000);
    case 'debug':
      return Math.min(Math.ceil(inputTokens * 0.7), 3000);
    case 'code_change':
    case 'refactor':
      return Math.min(Math.ceil(inputTokens * 1.2), 8000);
    case 'create':
      return Math.min(Math.ceil(inputTokens * 2.0), 12000);
    // Non-code tasks
    case 'writing':
    case 'communication':
      return Math.min(Math.ceil(inputTokens * 1.5), 4000);
    case 'research':
      return Math.min(Math.ceil(inputTokens * 2.0), 6000);
    case 'planning':
      return Math.min(Math.ceil(inputTokens * 1.5), 5000);
    case 'analysis':
      return Math.min(Math.ceil(inputTokens * 1.2), 4000);
    case 'data':
      return Math.min(Math.ceil(inputTokens * 0.8), 3000);
    default:
      return Math.min(inputTokens, 4000);
  }
}

// ─── Cost Calculation ─────────────────────────────────────────────────────────

function calculateCost(
  provider: string,
  model: string,
  inputRate: number,
  outputRate: number,
  inputTokens: number,
  outputTokens: number,
): ModelCost {
  const inputCost = (inputTokens / 1_000_000) * inputRate;
  const outputCost = (outputTokens / 1_000_000) * outputRate;

  return {
    provider,
    model,
    input_tokens: inputTokens,
    estimated_output_tokens: outputTokens,
    input_cost_usd: Math.round(inputCost * 1_000_000) / 1_000_000,
    output_cost_usd: Math.round(outputCost * 1_000_000) / 1_000_000,
    total_cost_usd: Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000,
  };
}

/** Build cost entries for a specific provider. */
function costsForProvider(
  provider: Provider,
  inputTokens: number,
  outputTokens: number,
): ModelCost[] {
  const models = PRICING_DATA.providers[provider];
  return Object.entries(models).map(([model, pricing]) =>
    calculateCost(provider, model, pricing.in, pricing.out, inputTokens, outputTokens)
  );
}

// ─── Model Recommendation ─────────────────────────────────────────────────────

function recommendModel(
  taskType: TaskType,
  riskLevel: RiskLevel,
  inputTokens: number,
  target: OutputTarget,
): { model: string; reason: string } {
  // High risk → always top-tier
  if (riskLevel === 'high') {
    if (target === 'openai') return { model: 'o1', reason: 'High-risk task — maximum capability recommended for safety.' };
    return { model: 'opus', reason: 'High-risk task — maximum capability recommended for safety.' };
  }

  // Target-aware recommendations
  if (target === 'openai') {
    if (taskType === 'question' || taskType === 'data') {
      return { model: 'gpt-4o-mini', reason: 'Lightweight task — GPT-4o Mini is fast and cost-effective.' };
    }
    if ((taskType === 'create' || taskType === 'refactor') && inputTokens > 10000) {
      return { model: 'o1', reason: 'Large-scope creation/refactoring — o1 provides best reasoning.' };
    }
    return { model: 'gpt-4o', reason: 'Balanced task — GPT-4o offers the best quality-to-cost ratio.' };
  }

  if (target === 'generic') {
    // Generic target — recommend Anthropic models (best generic markdown compliance)
    if (taskType === 'question' || taskType === 'data') {
      return { model: 'haiku', reason: 'Lightweight task — Haiku is fast and cost-effective.' };
    }
    if (taskType === 'writing' || taskType === 'communication') {
      return { model: 'sonnet', reason: 'Writing task — Sonnet produces high-quality prose at reasonable cost.' };
    }
    return { model: 'sonnet', reason: 'Balanced task — Sonnet offers the best quality-to-cost ratio.' };
  }

  // Claude target (default)
  if (taskType === 'question') {
    return { model: 'haiku', reason: 'Simple question — Haiku is fast and cost-effective.' };
  }
  if (taskType === 'review' && inputTokens < 5000) {
    return { model: 'haiku', reason: 'Code review with moderate context — Haiku handles this well.' };
  }
  if (taskType === 'data') {
    return { model: 'haiku', reason: 'Data transformation — Haiku handles structured operations well.' };
  }
  if (taskType === 'writing' || taskType === 'communication') {
    return { model: 'sonnet', reason: 'Writing task — Sonnet produces high-quality prose at reasonable cost.' };
  }
  if (taskType === 'research' || taskType === 'analysis') {
    return { model: 'sonnet', reason: 'Research/analysis — Sonnet offers strong reasoning at reasonable cost.' };
  }
  if (taskType === 'planning' && inputTokens > 5000) {
    return { model: 'opus', reason: 'Complex planning task — Opus provides best strategic reasoning.' };
  }
  if ((taskType === 'create' || taskType === 'refactor') && inputTokens > 10000) {
    return { model: 'opus', reason: 'Large-scope creation/refactoring — Opus provides best architectural reasoning.' };
  }
  return { model: 'sonnet', reason: 'Balanced task — Sonnet offers the best quality-to-cost ratio.' };
}

// ─── v3 Model Routing (Decision Engine) ─────────────────────────────────────

/**
 * Pick the default tier from complexity + risk score.
 * Step 1 of the 2-step routing algorithm.
 */
function pickDefaultTier(
  complexity: import('./types.js').ReasoningComplexity,
  riskScore: number,
  decisionPath: string[],
): ModelTier {
  let tier: ModelTier;

  switch (complexity) {
    case 'simple_factual':
      tier = 'small';
      break;
    case 'analytical':
      tier = 'mid';
      break;
    case 'multi_step':
      tier = riskScore >= RISK_ESCALATION_THRESHOLD ? 'top' : 'mid';
      break;
    case 'creative':
      tier = 'mid';
      break;
    case 'long_context':
      tier = 'mid';
      break;
    case 'agent_orchestration':
      tier = riskScore >= RISK_ESCALATION_THRESHOLD ? 'top' : 'mid';
      break;
    default:
      tier = 'mid';
  }

  decisionPath.push(`complexity=${complexity}`);
  decisionPath.push(`risk_score=${riskScore}`);
  decisionPath.push(`default_tier=${tier}`);
  return tier;
}

/**
 * Apply budget/latency overrides (Step 2).
 * Downgrades tier when budget or latency sensitivity is high.
 */
function applyOverrides(
  tier: ModelTier,
  budgetSensitivity: 'low' | 'medium' | 'high',
  latencySensitivity: 'low' | 'medium' | 'high',
  contextTokens: number,
  complexity: import('./types.js').ReasoningComplexity,
  decisionPath: string[],
): ModelTier {
  let current = tier;

  // Budget override: high budget sensitivity → downgrade one tier
  if (budgetSensitivity === 'high') {
    if (current === 'top') {
      current = 'mid';
      decisionPath.push('budget_override=downgrade_top→mid');
    } else if (current === 'mid') {
      current = 'small';
      decisionPath.push('budget_override=downgrade_mid→small');
    }
  }

  // Latency override: high latency sensitivity → prefer smaller within tier
  // Only downgrades if not already small
  if (latencySensitivity === 'high' && current === 'top') {
    current = 'mid';
    decisionPath.push('latency_override=downgrade_top→mid');
  }

  // Small context + simple_factual → force small even if risk is elevated
  if (contextTokens < 2000 && complexity === 'simple_factual' && current !== 'small') {
    decisionPath.push(`context_override=force_small (contextTokens=${contextTokens})`);
    current = 'small';
  }

  if (current !== tier) {
    decisionPath.push(`final_tier=${current}`);
  }

  return current;
}

/**
 * Pick primary model from tier based on target preference.
 * For research-intent prompts, pick Perplexity from tier.
 */
function pickPrimaryFromTier(
  tier: ModelTier,
  target: OutputTarget,
  researchIntent: boolean,
  decisionPath: string[],
): TierModelEntry {
  const tierModels = TIER_MODELS[tier];

  // Research intent → prefer Perplexity
  if (researchIntent) {
    const perplexityEntry = tierModels.find(e => e.provider === 'perplexity');
    if (perplexityEntry) {
      decisionPath.push('research_intent=true');
      decisionPath.push(`selected=${perplexityEntry.provider}/${perplexityEntry.model}`);
      return perplexityEntry;
    }
  }

  // Target-based preference
  let preferredProvider: string;
  switch (target) {
    case 'openai':
      preferredProvider = 'openai';
      break;
    case 'claude':
      preferredProvider = 'anthropic';
      break;
    default:
      preferredProvider = 'anthropic'; // generic → default to Anthropic
  }

  const primary = tierModels.find(e => e.provider === preferredProvider) ?? tierModels[0];
  decisionPath.push(`selected=${primary.provider}/${primary.model}`);
  return primary;
}

/**
 * Pick fallback model — must differ from primary's provider.
 */
function pickFallback(
  tier: ModelTier,
  primaryProvider: string,
  decisionPath: string[],
): { model: string; provider: string; reason: string } {
  const tierModels = TIER_MODELS[tier];
  // Pick first model from a different provider
  const fallback = tierModels.find(e => e.provider !== primaryProvider);
  if (fallback) {
    decisionPath.push(`fallback=${fallback.provider}/${fallback.model}`);
    return {
      model: fallback.model,
      provider: fallback.provider,
      reason: `Fallback from different provider (${fallback.provider}) for redundancy.`,
    };
  }
  // Edge case: only one provider in tier (shouldn't happen with current TIER_MODELS)
  const fb = tierModels[0];
  decisionPath.push(`fallback=${fb.provider}/${fb.model} (same_provider)`);
  return {
    model: fb.model,
    provider: fb.provider,
    reason: 'Only available option in tier.',
  };
}

/**
 * Compute confidence score (G3: deterministic formula).
 * start=60, +10 if complexity confidence≥80, +10 if risk<20,
 * -10 if budget/latency overrides applied, -10 if research_intent=true.
 * Clamped 0-100.
 */
function computeConfidence(
  complexityConfidence: number,
  riskScore: number,
  overridesApplied: boolean,
  researchIntent: boolean,
): number {
  let confidence = 60;
  if (complexityConfidence >= 80) confidence += 10;
  if (riskScore < 20) confidence += 10;
  if (overridesApplied) confidence -= 10;
  if (researchIntent) confidence -= 10;
  return Math.max(0, Math.min(100, confidence));
}

/**
 * Compute structured savings vs baseline (G2, G13).
 * Baseline: gpt-4o ($2.50/$10.00 per 1M tokens).
 */
function computeSavings(
  inputTokens: number,
  outputTokens: number,
  primaryModel: string,
  primaryProvider: string,
): SavingsComparison {
  const baselineCost =
    (inputTokens / 1_000_000) * BASELINE_IN_RATE +
    (outputTokens / 1_000_000) * BASELINE_OUT_RATE;

  // Look up recommended model's pricing
  const providerPricing = PRICING_DATA.providers[primaryProvider as Provider];
  let recInRate = BASELINE_IN_RATE;
  let recOutRate = BASELINE_OUT_RATE;
  if (providerPricing) {
    const modelPricing = (providerPricing as Record<string, { in: number; out: number }>)[primaryModel];
    if (modelPricing) {
      recInRate = modelPricing.in;
      recOutRate = modelPricing.out;
    }
  }
  const recommendedCost =
    (inputTokens / 1_000_000) * recInRate +
    (outputTokens / 1_000_000) * recOutRate;

  const savingsPercent = baselineCost > 0
    ? Math.round(((baselineCost - recommendedCost) / baselineCost) * 100)
    : 0;

  return {
    baselineModel: BASELINE_MODEL,
    baselineCost: Math.round(baselineCost * 1_000_000) / 1_000_000,
    recommendedCost: Math.round(recommendedCost * 1_000_000) / 1_000_000,
    savingsPercent: Math.max(0, savingsPercent), // clamp: can't have negative savings
  };
}

/**
 * Generate human-readable tradeoffs based on routing decisions.
 */
function generateTradeoffs(
  tier: ModelTier,
  budgetSensitivity: 'low' | 'medium' | 'high',
  latencySensitivity: 'low' | 'medium' | 'high',
  researchIntent: boolean,
): string[] {
  const tradeoffs: string[] = [];

  if (tier === 'small') {
    tradeoffs.push('Fastest response time, lowest cost, but limited reasoning depth.');
  } else if (tier === 'mid') {
    tradeoffs.push('Balanced quality and cost — handles most tasks well.');
  } else {
    tradeoffs.push('Maximum reasoning capability, but higher cost and latency.');
  }

  if (budgetSensitivity === 'high') {
    tradeoffs.push('Budget sensitivity applied — model tier may be lower than ideal for quality.');
  }
  if (latencySensitivity === 'high') {
    tradeoffs.push('Latency sensitivity applied — faster model preferred over maximum capability.');
  }
  if (researchIntent) {
    tradeoffs.push('Research intent detected — Perplexity recommended for web-grounded answers.');
  }

  return tradeoffs;
}

/**
 * Route a model recommendation based on structured input.
 * Deterministic, offline, zero LLM calls.
 *
 * 2-step algorithm:
 *   Step 1: Pick default tier from complexity + risk
 *   Step 2: Apply budget/latency overrides
 *
 * @param input - Structured routing input (G16: uses riskScore 0-100, not riskLevel)
 * @param promptText - Optional raw prompt for research intent detection (G15)
 * @param complexityConfidence - Confidence from classifyComplexity (for G3 formula)
 * @param target - Output target for provider preference (default: 'claude')
 */
export function routeModel(
  input: ModelRoutingInput,
  promptText?: string,
  complexityConfidence: number = 60,
  target: OutputTarget = 'claude',
): ModelRecommendation {
  const decisionPath: string[] = [];

  // Resolve profile (fallback to balanced if invalid)
  const profile = resolveProfile(input.profile, decisionPath);
  const profileSpec = PROFILES[profile];
  decisionPath.push(`profile=${profile}`);

  // Merge profile defaults with explicit inputs (explicit wins)
  const budgetSensitivity = input.budgetSensitivity ?? profileSpec.budgetSensitivity;
  const latencySensitivity = input.latencySensitivity ?? profileSpec.latencySensitivity;

  // Step 1: Pick default tier from complexity + risk
  let tier = pickDefaultTier(input.complexity, input.riskScore, decisionPath);

  // Step 2: Apply budget/latency overrides
  const tierBeforeOverrides = tier;
  tier = applyOverrides(
    tier, budgetSensitivity, latencySensitivity,
    input.contextTokens, input.complexity, decisionPath,
  );
  const overridesApplied = tier !== tierBeforeOverrides;

  // Detect research intent (G15: strict regex, prompt text only)
  const researchIntent = promptText ? RESEARCH_INTENT_RE.test(promptText) : false;

  // Pick primary model from tier
  const primaryEntry = pickPrimaryFromTier(tier, target, researchIntent, decisionPath);

  // Apply profile temperature + maxTokens (profile defaults, overridden by tier defaults if profile is 'balanced')
  const temperature = profileSpec.temperature ?? primaryEntry.defaultTemp;
  const maxTokens = profileSpec.maxTokensCap ?? primaryEntry.maxTokensCap;

  // Pick fallback (different provider)
  const fallback = pickFallback(tier, primaryEntry.provider, decisionPath);

  // Compute cost estimate for the recommended model
  const inputTokens = input.contextTokens;
  const outputTokens = estimateOutputTokens(inputTokens, input.taskType);

  const allCosts = sortCostEntries([
    ...costsForProvider('anthropic', inputTokens, outputTokens),
    ...costsForProvider('openai', inputTokens, outputTokens),
    ...costsForProvider('google', inputTokens, outputTokens),
    ...costsForProviderSafe('perplexity', inputTokens, outputTokens),
  ]);

  const costEstimate: import('./types.js').CostEstimate = {
    input_tokens: inputTokens,
    estimated_output_tokens: outputTokens,
    costs: allCosts,
    recommended_model: primaryEntry.model,
    recommendation_reason: `Routed via decision engine: ${profile} profile, ${tier} tier.`,
  };

  // Compute confidence (G3)
  const confidence = computeConfidence(
    complexityConfidence, input.riskScore, overridesApplied, researchIntent,
  );

  // Compute savings vs baseline (G2, G13)
  const savings = computeSavings(inputTokens, outputTokens, primaryEntry.model, primaryEntry.provider);
  decisionPath.push(`baseline_model=${BASELINE_MODEL}`);

  // Generate rationale
  const riskLevel = deriveRiskLevel(input.riskScore);
  const rationale = `${input.complexity} task (risk: ${riskLevel}, score: ${input.riskScore}) → ${tier} tier → ${primaryEntry.provider}/${primaryEntry.model}. Profile: ${profile}.`;

  // Generate tradeoffs
  const tradeoffs = generateTradeoffs(tier, budgetSensitivity, latencySensitivity, researchIntent);

  // Savings summary (display label)
  const savingsSummary = savings.savingsPercent > 0
    ? `${savings.savingsPercent}% cheaper than always using ${BASELINE_MODEL}`
    : `Comparable cost to ${BASELINE_MODEL}`;

  return {
    primary: {
      model: primaryEntry.model,
      provider: primaryEntry.provider,
      temperature,
      maxTokens,
    },
    fallback,
    confidence,
    costEstimate,
    rationale,
    tradeoffs,
    savings_vs_default: savings,
    savings_summary: savingsSummary,
    decision_path: decisionPath,
  };
}

/**
 * Safe costsForProvider that handles providers not in the type union.
 * Used for Perplexity which was added after the original Provider type.
 */
function costsForProviderSafe(
  provider: string,
  inputTokens: number,
  outputTokens: number,
): ModelCost[] {
  const providerData = PRICING_DATA.providers[provider as Provider];
  if (!providerData) return [];
  return Object.entries(providerData).map(([model, pricing]) =>
    calculateCost(provider, model, (pricing as { in: number; out: number }).in, (pricing as { in: number; out: number }).out, inputTokens, outputTokens)
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Full cost estimation for a prompt. Multi-provider, target-aware. */
export function estimateCost(
  promptText: string,
  taskType: TaskType = 'other',
  riskLevel: RiskLevel = 'medium',
  target: OutputTarget = 'claude',
): CostEstimate {
  const inputTokens = estimateTokens(promptText);
  const outputTokens = estimateOutputTokens(inputTokens, taskType);
  const { model, reason } = recommendModel(taskType, riskLevel, inputTokens, target);

  // Build costs for all providers (including Perplexity v3)
  let costs: ModelCost[] = [
    ...costsForProvider('anthropic', inputTokens, outputTokens),
    ...costsForProvider('openai', inputTokens, outputTokens),
    ...costsForProvider('google', inputTokens, outputTokens),
    ...costsForProvider('perplexity', inputTokens, outputTokens),
  ];

  // Deterministic sort: provider asc, model asc
  costs = sortCostEntries(costs);

  return {
    input_tokens: inputTokens,
    estimated_output_tokens: outputTokens,
    costs,
    recommended_model: model,
    recommendation_reason: reason,
  };
}

/** Standalone cost estimate for any text. Multi-provider. */
export function estimateCostForText(
  text: string,
  target: OutputTarget = 'claude',
): CostEstimate {
  const inputTokens = estimateTokens(text);
  const outputTokens = Math.min(Math.ceil(inputTokens * 0.8), 4000);

  const costs = sortCostEntries([
    ...costsForProvider('anthropic', inputTokens, outputTokens),
    ...costsForProvider('openai', inputTokens, outputTokens),
    ...costsForProvider('google', inputTokens, outputTokens),
    ...costsForProvider('perplexity', inputTokens, outputTokens),
  ]);

  return {
    input_tokens: inputTokens,
    estimated_output_tokens: outputTokens,
    costs,
    recommended_model: 'sonnet',
    recommendation_reason: 'Sonnet recommended as default balance of quality and cost.',
  };
}
