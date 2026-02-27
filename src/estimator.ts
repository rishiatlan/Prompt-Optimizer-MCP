// estimator.ts — Token counting, multi-provider cost estimation, and model recommendation.
// Supports Anthropic, OpenAI, and Google models. Target-aware recommendations.

import type { CostEstimate, ModelCost, TaskType, RiskLevel, OutputTarget } from './types.js';
import { sortCostEntries } from './sort.js';

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
  },
} as const;

type Provider = keyof typeof PRICING_DATA.providers;

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

  // Build costs for the target's primary provider + others for comparison
  let costs: ModelCost[];
  if (target === 'openai') {
    costs = [
      ...costsForProvider('openai', inputTokens, outputTokens),
      ...costsForProvider('anthropic', inputTokens, outputTokens),
      ...costsForProvider('google', inputTokens, outputTokens),
    ];
  } else if (target === 'generic') {
    costs = [
      ...costsForProvider('anthropic', inputTokens, outputTokens),
      ...costsForProvider('openai', inputTokens, outputTokens),
      ...costsForProvider('google', inputTokens, outputTokens),
    ];
  } else {
    // claude (default)
    costs = [
      ...costsForProvider('anthropic', inputTokens, outputTokens),
      ...costsForProvider('openai', inputTokens, outputTokens),
      ...costsForProvider('google', inputTokens, outputTokens),
    ];
  }

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
  ]);

  return {
    input_tokens: inputTokens,
    estimated_output_tokens: outputTokens,
    costs,
    recommended_model: 'sonnet',
    recommendation_reason: 'Sonnet recommended as default balance of quality and cost.',
  };
}
