// types.ts — All TypeScript interfaces for the prompt optimizer.

// ─── Enums ────────────────────────────────────────────────────────────────────

export type TaskType =
  // Code tasks
  | 'code_change'
  | 'question'
  | 'review'
  | 'debug'
  | 'create'
  | 'refactor'
  // Non-code tasks
  | 'writing'
  | 'research'
  | 'planning'
  | 'analysis'
  | 'communication'
  | 'data'
  | 'other';

/** Whether a task type is code-related. Used by rules, scorer, and compiler to adapt behavior. */
export function isCodeTask(taskType: TaskType): boolean {
  return ['code_change', 'debug', 'create', 'refactor'].includes(taskType);
}

/** Whether a task type involves prose/communication. */
export function isProseTask(taskType: TaskType): boolean {
  return ['writing', 'communication', 'planning'].includes(taskType);
}

export type RiskLevel = 'low' | 'medium' | 'high';

export type SessionState = 'ANALYZING' | 'COMPILED' | 'APPROVED';

export type RuleSeverity = 'blocking' | 'non_blocking';

export type ModelTier = 'haiku' | 'sonnet' | 'opus';

// ─── Ambiguity Rules ──────────────────────────────────────────────────────────

export interface Question {
  id: string;
  question: string;
  reason: string;
  blocking: boolean;
}

export interface Assumption {
  id: string;
  assumption: string;
  confidence: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  reversible: boolean;
}

export interface RuleResult {
  rule_name: string;
  severity: RuleSeverity;
  triggered: boolean;
  message: string;
  question?: Question;
  assumption?: Assumption;
  risk_elevation?: RiskLevel;
}

// ─── Intent Spec ──────────────────────────────────────────────────────────────

export interface IntentSpec {
  user_intent: string;
  goal: string;
  definition_of_done: string[];
  task_type: TaskType;
  inputs_detected: string[];
  constraints: {
    scope: string[];
    forbidden: string[];
    time_budget?: string;
  };
  output_format: string;
  risk_level: RiskLevel;
  assumptions: Assumption[];
  blocking_questions: Question[];
}

// ─── Quality Score ────────────────────────────────────────────────────────────

export interface QualityDimension {
  name: string;
  score: number;
  max: number;
  notes: string[];
}

export interface QualityScore {
  total: number;
  max: 100;
  dimensions: QualityDimension[];
}

// ─── Cost Estimation ──────────────────────────────────────────────────────────

export interface ModelCost {
  model: ModelTier;
  input_tokens: number;
  estimated_output_tokens: number;
  input_cost_usd: number;
  output_cost_usd: number;
  total_cost_usd: number;
}

export interface CostEstimate {
  input_tokens: number;
  estimated_output_tokens: number;
  costs: ModelCost[];
  recommended_model: ModelTier;
  recommendation_reason: string;
}

// ─── Preview Pack ─────────────────────────────────────────────────────────────

export interface PreviewPack {
  session_id: string;
  state: SessionState;
  intent_spec: IntentSpec;
  quality_before: QualityScore;
  compiled_prompt: string;
  quality_after: QualityScore;
  blocking_questions: Question[];
  assumptions: Assumption[];
  cost_estimate: CostEstimate;
  model_recommendation: ModelTier;
  changes_made: string[];
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  state: SessionState;
  created_at: number;
  last_accessed: number;
  raw_prompt: string;
  context?: string;
  intent_spec: IntentSpec;
  compiled_prompt: string;
  quality_before: QualityScore;
  quality_after: QualityScore;
  cost_estimate: CostEstimate;
  answers: Record<string, string>;
}

// ─── Compression Result ───────────────────────────────────────────────────────

export interface CompressionResult {
  original_tokens: number;
  compressed_tokens: number;
  tokens_saved: number;
  savings_percent: number;
  compressed_context: string;
  removed_sections: string[];
}
