// estimator.ts — Token counting, cost estimation, and model recommendation.

import type { CostEstimate, ModelCost, ModelTier, TaskType, RiskLevel } from './types.js';

// ─── Pricing (per 1M tokens, as of early 2026) ───────────────────────────────

const PRICING: Record<ModelTier, { input: number; output: number }> = {
  haiku:  { input: 0.80,   output: 4.00  },
  sonnet: { input: 3.00,   output: 15.00 },
  opus:   { input: 15.00,  output: 75.00 },
};

// ─── Token Estimation ─────────────────────────────────────────────────────────

/** Approximate token count. ~4 chars per token for English text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimate output tokens based on task type and input size. */
function estimateOutputTokens(inputTokens: number, taskType: TaskType): number {
  switch (taskType) {
    case 'question':
      return Math.min(inputTokens, 500); // Short answers
    case 'review':
      return Math.min(Math.ceil(inputTokens * 0.5), 2000);
    case 'debug':
      return Math.min(Math.ceil(inputTokens * 0.7), 3000);
    case 'code_change':
    case 'refactor':
      return Math.min(Math.ceil(inputTokens * 1.2), 8000);
    case 'create':
      return Math.min(Math.ceil(inputTokens * 2.0), 12000);
    default:
      return Math.min(inputTokens, 4000);
  }
}

// ─── Cost Calculation ─────────────────────────────────────────────────────────

function calculateCost(model: ModelTier, inputTokens: number, outputTokens: number): ModelCost {
  const pricing = PRICING[model];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  return {
    model,
    input_tokens: inputTokens,
    estimated_output_tokens: outputTokens,
    input_cost_usd: Math.round(inputCost * 1_000_000) / 1_000_000,
    output_cost_usd: Math.round(outputCost * 1_000_000) / 1_000_000,
    total_cost_usd: Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000,
  };
}

// ─── Model Recommendation ─────────────────────────────────────────────────────

function recommendModel(taskType: TaskType, riskLevel: RiskLevel, inputTokens: number): { model: ModelTier; reason: string } {
  // High risk → always Opus
  if (riskLevel === 'high') {
    return { model: 'opus', reason: 'High-risk task — maximum capability recommended for safety.' };
  }

  // Questions and reviews → Haiku (fast, cheap)
  if (taskType === 'question') {
    return { model: 'haiku', reason: 'Simple question — Haiku is fast and cost-effective.' };
  }

  if (taskType === 'review' && inputTokens < 5000) {
    return { model: 'haiku', reason: 'Code review with moderate context — Haiku handles this well.' };
  }

  // Large-scope creation or refactoring → Opus
  if ((taskType === 'create' || taskType === 'refactor') && inputTokens > 10000) {
    return { model: 'opus', reason: 'Large-scope creation/refactoring — Opus provides best architectural reasoning.' };
  }

  // Default → Sonnet (best balance)
  return { model: 'sonnet', reason: 'Balanced task — Sonnet offers the best quality-to-cost ratio.' };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Full cost estimation for a prompt. */
export function estimateCost(
  promptText: string,
  taskType: TaskType = 'other',
  riskLevel: RiskLevel = 'medium',
): CostEstimate {
  const inputTokens = estimateTokens(promptText);
  const outputTokens = estimateOutputTokens(inputTokens, taskType);
  const { model, reason } = recommendModel(taskType, riskLevel, inputTokens);

  return {
    input_tokens: inputTokens,
    estimated_output_tokens: outputTokens,
    costs: [
      calculateCost('haiku', inputTokens, outputTokens),
      calculateCost('sonnet', inputTokens, outputTokens),
      calculateCost('opus', inputTokens, outputTokens),
    ],
    recommended_model: model,
    recommendation_reason: reason,
  };
}

/** Standalone cost estimate for any text + model. */
export function estimateCostForText(text: string, model?: ModelTier): CostEstimate {
  const inputTokens = estimateTokens(text);
  const outputTokens = Math.min(Math.ceil(inputTokens * 0.8), 4000);

  const costs = model
    ? [calculateCost(model, inputTokens, outputTokens)]
    : [
        calculateCost('haiku', inputTokens, outputTokens),
        calculateCost('sonnet', inputTokens, outputTokens),
        calculateCost('opus', inputTokens, outputTokens),
      ];

  return {
    input_tokens: inputTokens,
    estimated_output_tokens: outputTokens,
    costs,
    recommended_model: model || 'sonnet',
    recommendation_reason: model
      ? `Cost estimate for ${model}.`
      : 'Sonnet recommended as default balance of quality and cost.',
  };
}
