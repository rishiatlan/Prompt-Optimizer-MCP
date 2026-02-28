// src/api.ts — Programmatic API barrel export (v3.1).
// Pure, synchronous, zero side effects. Safe for library use.
// Does NOT start the MCP server (use `claude-prompt-optimizer-mcp/server` for that).
// v3 additions: classifyComplexity, routeModel, computeRiskScore, PROFILES, TIER_MODELS.
// v3.1 additions: pruner, tokenizer, zones, preservePatterns, deltas, constants.

// ─── Analyzer ────────────────────────────────────────────────────────────────
export { analyzePrompt, detectTaskType, classifyComplexity } from './analyzer.js';

// ─── Scorer ──────────────────────────────────────────────────────────────────
export { scorePrompt } from './scorer.js';

// ─── Checklist (operates on *compiled* output, not raw prompt) ───────────────
export { generateChecklist } from './scorer.js';

// ─── Compiler ────────────────────────────────────────────────────────────────
export { compilePrompt, compressContext } from './compiler.js';

// ─── Cost Estimator + Model Routing ─────────────────────────────────────────
export {
  estimateCost, estimateTokens, estimateCostForText, PRICING_DATA,
  routeModel, TIER_MODELS, RESEARCH_INTENT_RE,
} from './estimator.js';

// ─── Rules Engine ────────────────────────────────────────────────────────────
export {
  runRules, extractBlockingQuestions, extractAssumptions, getElevatedRisk,
  computeRiskScore, RISK_WEIGHTS, RISK_ESCALATION_THRESHOLD, deriveRiskLevel,
} from './rules.js';

// ─── Profiles ────────────────────────────────────────────────────────────────
export { PROFILES, suggestProfile, resolveProfile } from './profiles.js';

// ─── License Validation ──────────────────────────────────────────────────────
export { validateLicenseKey, canonicalizePayload, PRODUCTION_PUBLIC_KEY_PEM } from './license.js';

// ─── v3.1: Compression Pipeline ─────────────────────────────────────────────
export { estimatePromptTokens, estimateToolTokens, estimateOutputTokens } from './tokenizer.js';
export { scanZones, isLineInZone, isLinePreserved, getZonesInRange } from './zones.js';
export type { Zone } from './zones.js';
export { markPreservedLines } from './preservePatterns.js';
export { scoreAllTools, rankTools, pruneTools, scoreTool, rankMode, pruneMode } from './pruner.js';
export type { ToolDefinition, ToolScore, PruningResult } from './pruner.js';
export {
  calculateCompressionDelta, calculateToolPruningDelta,
  calculatePreFlightDeltas, formatDelta, formatPreFlightDeltas,
} from './deltas.js';
export type { PreFlightDelta, PreFlightDeltas } from './deltas.js';
export {
  PRUNE_THRESHOLD, SIGNALS_CAP, LICENSE_SCAN_LINES, STRONG_LEGAL_TOKENS,
  ALWAYS_RELEVANT_TOOLS, TASK_REQUIRED_TOOLS, TASK_NEGATIVE_TOOLS,
  TASK_TOOL_KEYWORDS, stableStringify,
} from './constants.js';

// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  TaskType,
  RiskLevel,
  OutputTarget,
  Tier,
  Question,
  Assumption,
  RuleResult,
  IntentSpec,
  QualityDimension,
  QualityScore,
  ChecklistItem,
  CompilationChecklist,
  ModelCost,
  CostEstimate,
  PreviewPack,
  CompressionResult,
  CompressionPipelineResult,
  CompressionConfig,
  CompressContextResult,
  LicenseData,
  TierLimits,
  EnforcementResult,
  // v3 Decision Engine types
  ReasoningComplexity,
  OptimizationProfile,
  ComplexityResult,
  RiskDimensions,
  RiskScore,
  SavingsComparison,
  TierModelEntry,
  ModelTier,
  ModelRoutingInput,
  ModelRecommendation,
} from './types.js';

export { isCodeTask, isProseTask, PLAN_LIMITS } from './types.js';

// ─── Purchase URLs (canonical source) ────────────────────────────────────────
export { PRO_PURCHASE_URL, POWER_PURCHASE_URL } from './tools.js';

// ─── Convenience: optimize() ─────────────────────────────────────────────────

import { analyzePrompt } from './analyzer.js';
import { scorePrompt, generateChecklist } from './scorer.js';
import { compilePrompt } from './compiler.js';
import { estimateCost } from './estimator.js';
import type {
  IntentSpec,
  QualityScore,
  CompilationChecklist,
  CostEstimate,
  OutputTarget,
} from './types.js';

/** Result of the full optimization pipeline. */
export interface OptimizeResult {
  /** Parsed intent from the raw prompt. */
  intent: IntentSpec;
  /** Quality score of the *raw* prompt (before compilation). */
  quality: QualityScore;
  /** Optimized prompt string (formatted for the target LLM). */
  compiled: string;
  /** List of structural changes applied during compilation. */
  changes: string[];
  /** Structural coverage checklist of the *compiled* output. */
  checklist: CompilationChecklist;
  /** Token + cost estimates for the compiled prompt. */
  cost: CostEstimate;
}

/**
 * Run the full optimization pipeline on a prompt.
 *
 * Mirrors the exact production chain from the `optimize_prompt` MCP tool:
 *   analyzePrompt → scorePrompt → compilePrompt → generateChecklist → estimateCost
 *
 * Pure, synchronous, deterministic. No I/O, no side effects.
 *
 * @param prompt  - The raw prompt to optimize.
 * @param context - Optional context string (code, docs, etc.).
 * @param target  - Target LLM format: 'claude' (XML), 'openai' (System/User), 'generic' (Markdown).
 */
export function optimize(
  prompt: string,
  context?: string,
  target: OutputTarget = 'claude',
): OptimizeResult {
  // 1. Analyze raw prompt → structured intent
  const intent = analyzePrompt(prompt, context);

  // 2. Score the raw prompt's quality (pre-compilation)
  const quality = scorePrompt(intent, context);

  // 3. Compile into target format
  const { prompt: compiled, changes } = compilePrompt(intent, context, target);

  // 4. Checklist: structural coverage of the compiled output
  const checklist = generateChecklist(compiled);

  // 5. Estimate cost — join prompt+context with delimiter (not naive concatenation)
  const costInput = context
    ? `${compiled}\n\n---\n\n${context}`
    : compiled;
  const cost = estimateCost(costInput, intent.task_type, intent.risk_level, target);

  return { intent, quality, compiled, changes, checklist, cost };
}
