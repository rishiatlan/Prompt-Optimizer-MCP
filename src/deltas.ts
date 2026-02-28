// deltas.ts — Pre-flight delta calculation for compression and pruning savings
// Shows estimated tokens saved before user commits to optimization

import type { IntentSpec } from './types.js';
import type { CompressionPipelineResult } from './types.js';
import type { ToolScore } from './pruner.js';

/**
 * Pre-flight delta: estimated token savings from a single optimization
 */
export interface PreFlightDelta {
  optimization: 'compression' | 'tool_pruning';
  tokens_saved_estimate: number;
  percentage_reduction: number; // tokens_saved / original * 100
}

/**
 * All pre-flight deltas for a prompt
 */
export interface PreFlightDeltas {
  original_tokens: number;
  estimated_total_savings: number;
  deltas: PreFlightDelta[];
  summary: string;
}

/**
 * Calculate compression delta
 * Present only if compression actually reduces tokens
 */
export function calculateCompressionDelta(
  compressionResult: CompressionPipelineResult
): PreFlightDelta | null {
  const tokensSaved = compressionResult.originalTokens - compressionResult.compressedTokens;

  if (tokensSaved <= 0) {
    // No compression benefit
    return null;
  }

  const percentage = (tokensSaved / compressionResult.originalTokens) * 100;

  return {
    optimization: 'compression',
    tokens_saved_estimate: tokensSaved,
    percentage_reduction: Math.round(percentage * 10) / 10,
  };
}

/**
 * Calculate tool pruning delta
 * Present only if pruning would remove tools
 */
export function calculateToolPruningDelta(
  scores: ToolScore[],
  prunedTools: string[]
): PreFlightDelta | null {
  if (prunedTools.length === 0) {
    return null;
  }

  let tokensSaved = 0;
  for (const toolName of prunedTools) {
    const score = scores.find(s => s.name === toolName);
    if (score) {
      tokensSaved += score.tokens_saved_estimate;
    }
  }

  if (tokensSaved <= 0) {
    return null;
  }

  // Original tokens = sum of all tool tokens
  const originalTokens = scores.reduce((sum, s) => sum + s.tokens_saved_estimate, 0);
  const percentage = (tokensSaved / originalTokens) * 100;

  return {
    optimization: 'tool_pruning',
    tokens_saved_estimate: tokensSaved,
    percentage_reduction: Math.round(percentage * 10) / 10,
  };
}

/**
 * Calculate all pre-flight deltas
 */
export function calculatePreFlightDeltas(
  compressionResult: CompressionPipelineResult | null,
  toolScores: ToolScore[] | null,
  prunedTools: string[] | null
): PreFlightDeltas {
  const deltas: PreFlightDelta[] = [];
  let originalTokens = 0;
  let totalSavings = 0;

  // Add compression delta
  if (compressionResult) {
    originalTokens = compressionResult.originalTokens;
    const compressionDelta = calculateCompressionDelta(compressionResult);
    if (compressionDelta) {
      deltas.push(compressionDelta);
      totalSavings += compressionDelta.tokens_saved_estimate;
    }
  }

  // Add tool pruning delta
  if (toolScores && prunedTools && prunedTools.length > 0) {
    const toolPruningDelta = calculateToolPruningDelta(toolScores, prunedTools);
    if (toolPruningDelta) {
      deltas.push(toolPruningDelta);
      totalSavings += toolPruningDelta.tokens_saved_estimate;
    }
  }

  // Generate summary
  let summary = '';
  if (deltas.length === 0) {
    summary = 'No optimizations would reduce token count';
  } else if (deltas.length === 1) {
    const delta = deltas[0];
    summary = `${delta.optimization.replace('_', ' ')} would save ~${delta.tokens_saved_estimate} tokens (${delta.percentage_reduction}% reduction)`;
  } else {
    summary = `Combined optimizations would save ~${totalSavings} tokens`;
  }

  return {
    original_tokens: originalTokens,
    estimated_total_savings: totalSavings,
    deltas,
    summary,
  };
}

/**
 * Format delta for human readability
 */
export function formatDelta(delta: PreFlightDelta): string {
  const label = delta.optimization === 'compression' ? 'Compression' : 'Tool Pruning';
  return `${label}: ~${delta.tokens_saved_estimate} tokens saved (${delta.percentage_reduction}%)`;
}

/**
 * Format all deltas for human readability
 */
export function formatPreFlightDeltas(deltas: PreFlightDeltas): string {
  if (deltas.deltas.length === 0) {
    return deltas.summary;
  }

  const lines = [deltas.summary];
  lines.push('');

  for (const delta of deltas.deltas) {
    lines.push(`  • ${formatDelta(delta)}`);
  }

  if (deltas.estimated_total_savings > 0) {
    const totalPercent = (deltas.estimated_total_savings / deltas.original_tokens) * 100;
    lines.push('');
    lines.push(`Total estimated savings: ~${deltas.estimated_total_savings} tokens (${Math.round(totalPercent * 10) / 10}%)`);
  }

  return lines.join('\n');
}
