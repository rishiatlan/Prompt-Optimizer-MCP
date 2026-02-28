// pruner.ts — Deterministic tool relevance scorer and pruner
// Ranks tools by relevance to task intent; marks bottom-M as pruned
// Never removes explicitly mentioned or always-relevant tools

import type { IntentSpec } from './types.js';
import { stableStringify, TASK_TOOL_KEYWORDS, ALWAYS_RELEVANT_TOOLS, TASK_REQUIRED_TOOLS, TASK_NEGATIVE_TOOLS, SIGNALS_CAP } from './constants.js';

/**
 * Tool definition: name + description for scoring
 */
export interface ToolDefinition {
  name: string;
  description: string;
}

/**
 * Scoring result for a single tool
 */
export interface ToolScore {
  name: string;
  relevance_score: number; // 0-100
  signals: string[]; // human-readable signals used
  tokens_saved_estimate: number; // estimated tokens if tool removed
}

/**
 * Pruning result
 */
export interface PruningResult {
  tools: ToolScore[];
  pruned_count: number;
  pruned_tools: string[];
  tokens_saved_estimate: number;
  mode: 'rank' | 'prune';
}

/**
 * Estimate tokens for a tool definition (chars / 4)
 */
function estimateToolTokens(tool: ToolDefinition): number {
  const toolJson = stableStringify(tool);
  return Math.ceil(toolJson.length / 4);
}

/**
 * Count keyword matches in text, case-insensitive
 */
function countKeywordMatches(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const keyword of keywords) {
    const re = new RegExp(`\\b${keyword}\\b`, 'gi');
    const matches = lower.match(re);
    count += (matches ? matches.length : 0);
  }
  return count;
}

/**
 * Score a single tool against the intent
 */
export function scoreTool(
  tool: ToolDefinition,
  spec: IntentSpec | undefined,
  taskKeywordsMap: Record<string, string[]>
): ToolScore {
  const signals: string[] = [];
  let score = 50; // Neutral baseline

  if (!spec) {
    // No spec = neutral scoring for all tools
    return {
      name: tool.name,
      relevance_score: score,
      signals,
      tokens_saved_estimate: estimateToolTokens(tool),
    };
  }

  const toolLower = tool.name.toLowerCase();
  const descLower = tool.description.toLowerCase();
  const intentLower = spec.user_intent.toLowerCase();
  const combinedText = `${intentLower} ${descLower}`;

  // ─── Direct mention (override everything) ────────────────────────────────
  if (intentLower.includes(toolLower)) {
    signals.push(`Explicitly mentioned in intent`);
    score = 95;
    return { name: tool.name, relevance_score: score, signals, tokens_saved_estimate: estimateToolTokens(tool) };
  }

  // ─── Task-specific required tools ────────────────────────────────────────
  const taskType = spec.task_type || 'unknown';
  const requiredForTask = TASK_REQUIRED_TOOLS[taskType] || [];
  if (requiredForTask.includes(toolLower)) {
    signals.push(`Required for ${taskType} tasks`);
    score += 25;
  }

  // ─── Task-specific negative signals ──────────────────────────────────────
  const negativeForTask = TASK_NEGATIVE_TOOLS[taskType] || [];
  if (negativeForTask.includes(toolLower)) {
    signals.push(`Deprioritized for ${taskType} tasks`);
    score -= 20;
  }

  // ─── Keyword matching (task type) ────────────────────────────────────────
  const taskKeywords = taskKeywordsMap[taskType] || [];
  const keywordMatches = countKeywordMatches(combinedText, taskKeywords);
  if (keywordMatches > 0) {
    signals.push(`${keywordMatches} keyword match(es) for ${taskType}`);
    score += Math.min(keywordMatches * 5, 15); // Cap at +15
  }

  // ─── General description match ───────────────────────────────────────────
  if (descLower.length > 0) {
    // Brief description penalty (less useful for scoring)
    if (descLower.length < 20) {
      signals.push(`Brief description (${descLower.length} chars)`);
      score -= 5;
    } else {
      signals.push(`Substantial description (${descLower.length} chars)`);
      score += 5;
    }
  }

  // ─── Inputs detected ──────────────────────────────────────────────────────
  if (spec.inputs_detected && spec.inputs_detected.length > 0) {
    const inputMatch = spec.inputs_detected.some((input: string) =>
      descLower.includes(input.toLowerCase())
    );
    if (inputMatch) {
      signals.push(`Matches detected inputs`);
      score += 10;
    }
  }

  // ─── Platform hints (for prose tasks) ────────────────────────────────────
  if (spec.platform) {
    if (descLower.includes(spec.platform.toLowerCase())) {
      signals.push(`Matches platform: ${spec.platform}`);
      score += 8;
    }
  }

  // ─── Tone/audience (for prose tasks) ─────────────────────────────────────
  if (spec.tone && descLower.includes(spec.tone.toLowerCase())) {
    signals.push(`Matches tone: ${spec.tone}`);
    score += 5;
  }

  if (spec.audience && descLower.includes(spec.audience.toLowerCase())) {
    signals.push(`Matches audience: ${spec.audience}`);
    score += 5;
  }

  // ─── Scope constraints ───────────────────────────────────────────────────
  if (spec.constraints && spec.constraints.scope && spec.constraints.scope.length > 0) {
    const scopeText = spec.constraints.scope.join(' ').toLowerCase();
    if (descLower.includes(scopeText)) {
      signals.push(`Addresses scope constraints`);
      score += 8;
    }
  }

  // Clamp score to [0, 100]
  score = Math.max(0, Math.min(100, score));

  return {
    name: tool.name,
    relevance_score: score,
    signals: signals.slice(0, SIGNALS_CAP),
    tokens_saved_estimate: estimateToolTokens(tool),
  };
}

/**
 * Score all tools against the intent
 */
export function scoreAllTools(
  tools: ToolDefinition[],
  spec: IntentSpec | undefined,
  taskKeywordsMap: Record<string, string[]> = TASK_TOOL_KEYWORDS
): ToolScore[] {
  return tools.map(tool => scoreTool(tool, spec, taskKeywordsMap));
}

/**
 * Rank tools by relevance (highest to lowest)
 */
export function rankTools(scores: ToolScore[]): ToolScore[] {
  return [...scores].sort((a, b) => b.relevance_score - a.relevance_score);
}

/**
 * Prune tools: mark bottom-M as removable
 * Respects mention protection and always-relevant tools
 */
export function pruneTools(
  scores: ToolScore[],
  intent: string | undefined,
  pruneCount: number
): PruningResult {
  // Always-relevant tools (never prune)
  const alwaysRelevant = new Set(Array.from(ALWAYS_RELEVANT_TOOLS).map(t => t.toLowerCase()));

  // Tools explicitly mentioned in intent
  const mentioned = new Set<string>();
  if (intent) {
    const intentLower = intent.toLowerCase();
    for (const score of scores) {
      if (intentLower.includes(score.name.toLowerCase())) {
        mentioned.add(score.name.toLowerCase());
      }
    }
  }

  // Rank by relevance (lowest first for pruning)
  const ranked = [...scores].sort((a, b) => a.relevance_score - b.relevance_score);

  const prunedTools: string[] = [];
  let tokensRemoved = 0;

  for (const tool of ranked) {
    if (prunedTools.length >= pruneCount) break;

    const toolLower = tool.name.toLowerCase();
    if (alwaysRelevant.has(toolLower)) {
      // Never prune always-relevant tools
      continue;
    }

    if (mentioned.has(toolLower)) {
      // Never prune mentioned tools
      continue;
    }

    prunedTools.push(tool.name);
    tokensRemoved += tool.tokens_saved_estimate;
  }

  return {
    tools: scores,
    pruned_count: prunedTools.length,
    pruned_tools: prunedTools,
    tokens_saved_estimate: tokensRemoved,
    mode: 'prune',
  };
}

/**
 * Rank mode: return all tools ranked by relevance
 */
export function rankMode(
  tools: ToolDefinition[],
  spec: IntentSpec | undefined
): PruningResult {
  const scores = scoreAllTools(tools, spec);
  const ranked = rankTools(scores);

  return {
    tools: ranked,
    pruned_count: 0,
    pruned_tools: [],
    tokens_saved_estimate: 0,
    mode: 'rank',
  };
}

/**
 * Prune mode: return tools with bottom-M marked as pruned
 */
export function pruneMode(
  tools: ToolDefinition[],
  spec: IntentSpec | undefined,
  intent: string | undefined,
  pruneThreshold: number = 5
): PruningResult {
  const scores = scoreAllTools(tools, spec);
  return pruneTools(scores, intent, pruneThreshold);
}
