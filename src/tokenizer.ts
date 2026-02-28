// tokenizer.ts — Centralized token estimation for compression, rules, and cost analysis.
// All token calculations use the same deterministic method for consistency.

/**
 * Estimate tokens for a prompt/context string using the "words × 1.3" heuristic.
 * This is used for:
 * - Cost estimation (input_tokens)
 * - Rule detection (token_budget_mismatch)
 * - Compression metrics (original/compressed tokens)
 *
 * Method: Split on whitespace, multiply by 1.3 (empirical ratio Claude/token)
 * This is NOT a real tokenizer and will differ from actual token counts.
 * For precise counts, use Claude's actual tokenizer.
 *
 * @param text Input string (prompt, context, compiled output)
 * @returns Estimated token count
 */
export function estimatePromptTokens(text: string | undefined): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).length;
  return Math.ceil(words * 1.3);
}

/**
 * Estimate tokens for tool/utility definitions using the "chars/4" method.
 * This is used specifically for tool pruning to estimate tokens_saved when removing tools.
 *
 * Method: Character count divided by 4 (loose empirical ratio for definitions)
 * This differs from prompt estimation and is intentionally kept separate.
 *
 * @param definition Tool definition string (name + description + schema)
 * @returns Estimated token count for the tool definition
 */
export function estimateToolTokens(definition: string | undefined): number {
  if (!definition) return 0;
  return Math.ceil(definition.length / 4);
}

/**
 * Estimate output tokens based on context length.
 * Used for cost estimation and budget planning.
 *
 * Default: input_tokens * 0.5 (conservative estimate for typical Claude responses)
 * Can be tuned per task type or model tier.
 *
 * @param inputTokens Estimated input tokens
 * @param maxRatio Maximum ratio of output/input (default 0.5)
 * @returns Estimated output token count
 */
export function estimateOutputTokens(
  inputTokens: number,
  maxRatio: number = 0.5
): number {
  return Math.ceil(inputTokens * maxRatio);
}

/**
 * Test helpers: determinism check for token estimator.
 * Same input should always produce same output.
 */
export function areTokenEstimatesDeterministic(
  text: string,
  iterations: number = 3
): boolean {
  const estimates = Array.from({ length: iterations }, () =>
    estimatePromptTokens(text)
  );
  return estimates.every(e => e === estimates[0]);
}
