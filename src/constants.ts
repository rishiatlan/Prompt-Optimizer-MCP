// constants.ts — Frozen configuration values for compression, pruning, and rules.
// These values are locked and must not change without explicit version bump + communication.

// ─── Compression Heuristics ────────────────────────────────────────────────────

/** Maximum line number to scan for license/header blocks (H2). */
export const LICENSE_SCAN_LINES = 40;

/** Strong legal tokens that must be present to trigger license removal. */
export const STRONG_LEGAL_TOKENS = /copyright|licensed under|spdx|apache|mit|gpl/i;

/** Maximum character length for JSON whole-input detection. */
export const JSON_MAX_CHARS = 200_000;

// ─── Tool Pruning ─────────────────────────────────────────────────────────────

/** Default threshold for pruning tools (0-100 relevance score). */
export const PRUNE_THRESHOLD = 15;

/** Maximum number of signals to consider in pruner scoring (cap to avoid explosion). */
export const SIGNALS_CAP = 10;

/** Task type keywords for pruner relevance matching (common tool/task overlaps). */
export const TASK_TOOL_KEYWORDS: Record<string, string[]> = {
  code_change: ['refactor', 'optimize', 'improve', 'performance'],
  debug: ['bug', 'error', 'crash', 'broken', 'failing', 'issue'],
  create: ['build', 'write', 'implement', 'add', 'new'],
  refactor: ['clean', 'reorganize', 'modernize', 'restructure'],
  review: ['check', 'audit', 'assess', 'examine', 'analyze'],
  writing: ['blog', 'article', 'email', 'slack', 'post', 'document'],
  research: ['investigate', 'explore', 'understand', 'survey'],
};

/** Tools that should always be considered relevant (never pruned). */
export const ALWAYS_RELEVANT_TOOLS = new Set(['search', 'read', 'write', 'edit', 'bash']);

/** Task-type-specific tools that are high-confidence matches. */
export const TASK_REQUIRED_TOOLS: Record<string, string[]> = {
  code_change: ['read', 'edit', 'bash'],
  debug: ['bash', 'read'],
  create: ['write', 'edit'],
  review: ['read'],
  writing: ['write'],
};

/** Negative signals: tools to deprioritize for specific task types. */
export const TASK_NEGATIVE_TOOLS: Record<string, string[]> = {
  writing: ['bash', 'debugger'],
  research: ['edit', 'bash'],
};

// ─── Risk Rules ───────────────────────────────────────────────────────────────

/** Token budget threshold for "mismatch" detection (per tier). */
export const TIER_TOKEN_BUDGETS: Record<string, number> = {
  small: 16_000,
  medium: 32_000,
  large: 64_000,
  default: 20_000,
};

/** Stopwords to exclude from intent overlap scoring (prevent inflated signals). */
export const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
]);

// ─── Deterministic Serialization ──────────────────────────────────────────────

/**
 * Stable stringify for tool definitions: sorted keys, no whitespace, deterministic.
 * Used by pruner for consistent tokens_saved estimation.
 * Must produce identical output across runs for the same object.
 *
 * @param obj Object to stringify
 * @returns Deterministic JSON string (no whitespace)
 */
export function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') return String(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) => `"${k}":${stableStringify((obj as Record<string, unknown>)[k])}`
  );
  return '{' + pairs.join(',') + '}';
}
