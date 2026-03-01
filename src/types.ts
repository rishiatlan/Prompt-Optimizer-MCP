// types.ts — All TypeScript interfaces for the prompt optimizer v2.0.
// This is the interface contract: Phase B must not change these shapes.

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

/** Canonical routing tier for the decision engine (G9: small/mid/top everywhere). */
export type ModelTier = 'small' | 'mid' | 'top';

// ─── Reasoning Complexity (v3 decision engine) ──────────────────────────────

export type ReasoningComplexity =
  | 'simple_factual'
  | 'analytical'
  | 'multi_step'
  | 'creative'
  | 'long_context'
  | 'agent_orchestration';

// ─── Optimization Profiles (v3 decision engine) ─────────────────────────────

export type OptimizationProfile =
  | 'cost_minimizer'
  | 'balanced'
  | 'quality_first'
  | 'creative'
  | 'enterprise_safe';

// ─── Complexity Classification Result ───────────────────────────────────────

export interface ComplexityResult {
  complexity: ReasoningComplexity;
  confidence: number;          // 0-100
  signals: string[];           // key=value pairs, sorted alphabetically, capped at 10
}

// ─── Risk Dimensions & Score (v3 decision engine) ───────────────────────────

export interface RiskDimensions {
  underspec: number;
  hallucination: number;
  scope: number;
  constraint: number;
}

export interface RiskScore {
  score: number;               // 0-100
  dimensions: RiskDimensions;
  level: RiskLevel;            // derived: 0-29=low, 30-59=medium, 60-100=high (G14)
}

// ─── Savings Comparison (structured numeric, G13) ───────────────────────────

export interface SavingsComparison {
  baselineModel: string;       // e.g. 'gpt-4o'
  baselineCost: number;        // USD total cost
  recommendedCost: number;     // USD total cost
  savingsPercent: number;      // 0-100
}

// ─── Tier Model Entry (G1) ──────────────────────────────────────────────────

export interface TierModelEntry {
  provider: string;
  model: string;
  defaultTemp: number;
  maxTokensCap: number;
}

// ─── Model Routing Input (v3 decision engine, G16) ──────────────────────────

export interface ModelRoutingInput {
  taskType: TaskType;
  complexity: ReasoningComplexity;
  budgetSensitivity: 'low' | 'medium' | 'high';
  latencySensitivity: 'low' | 'medium' | 'high';
  contextTokens: number;
  riskScore: number;           // 0-100 (G16: drives routing, not riskLevel)
  profile?: OptimizationProfile;
}

// ─── Model Recommendation (v3 decision engine) ─────────────────────────────

export interface ModelRecommendation {
  primary: {
    model: string;
    provider: string;
    temperature: number;
    maxTokens: number;
  };
  fallback: {
    model: string;
    provider: string;
    reason: string;
  };
  confidence: number;                  // 0-100 (G3: deterministic formula)
  costEstimate: CostEstimate;
  rationale: string;
  tradeoffs: string[];
  savings_vs_default: SavingsComparison;  // G13: structured numeric
  savings_summary: string;                // display label
  decision_path: string[];                // full audit trail
}

// ─── Output Target (multi-LLM) ───────────────────────────────────────────────

export type OutputTarget = 'claude' | 'openai' | 'generic';

// ─── Tier System ──────────────────────────────────────────────────────────────

export interface TierLimits {
  lifetime: number;          // total uses ever (free=10, pro/power=Infinity)
  monthly: number;           // per calendar month (free=10, pro=100, power=Infinity)
  rate_per_minute: number;   // sliding window rate limit (free=5, pro=30, power=60)
  always_on: boolean;        // can use always-on mode (free/pro=false, power=true)
}

/** Serialized tier limits (Infinity → null for JSON safety). */
export interface SerializedTierLimits {
  lifetime: number | null;   // null when Infinity (unlimited)
  monthly: number | null;    // null when Infinity (unlimited)
  rate_per_minute: number;
  always_on: boolean;
}

export const PLAN_LIMITS: Record<string, TierLimits> = {
  free:       { lifetime: 10,       monthly: 10,        rate_per_minute: 5,   always_on: false },
  pro:        { lifetime: Infinity, monthly: 100,       rate_per_minute: 30,  always_on: false },
  power:      { lifetime: Infinity, monthly: Infinity,  rate_per_minute: 60,  always_on: true },
  enterprise: { lifetime: Infinity, monthly: Infinity,  rate_per_minute: 120, always_on: true },
};

export type Tier = 'free' | 'pro' | 'power' | 'enterprise';

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
  audience?: string;
  tone?: string;
  platform?: string;
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

// ─── Compilation Checklist (replaces quality_after) ──────────────────────────

export interface ChecklistItem {
  name: string;
  present: boolean;
  note?: string;
}

export interface CompilationChecklist {
  items: ChecklistItem[];
  summary: string;
}

// ─── Cost Estimation ──────────────────────────────────────────────────────────

export interface ModelCost {
  model: string;
  provider: string;
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
  recommended_model: string;
  recommendation_reason: string;
}

// ─── Preview Pack ─────────────────────────────────────────────────────────────

export interface PreviewPack {
  request_id: string;
  session_id: string;
  state: SessionState;
  intent_spec: IntentSpec;
  quality_before: QualityScore;
  compiled_prompt: string;
  compilation_checklist: CompilationChecklist;
  blocking_questions: Question[];
  assumptions: Assumption[];
  cost_estimate: CostEstimate;
  model_recommendation: string;
  changes_made: string[];
  target: OutputTarget;
  format_version: 1;
  scoring_version: 2;
  storage_health?: 'ok' | 'degraded';
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  state: SessionState;
  created_at: number;
  last_accessed: number;
  raw_prompt: string;
  context?: string;
  target: OutputTarget;
  intent_spec: IntentSpec;
  compiled_prompt: string;
  quality_before: QualityScore;
  compilation_checklist: CompilationChecklist;
  cost_estimate: CostEstimate;
  answers: Record<string, string>;
}

// ─── Compression Config (v3.1) ───────────────────────────────────────────────

export interface CompressionConfig {
  mode?: 'standard' | 'aggressive';      // default: 'standard'
  tokenBudget?: number;                   // for aggressive mode, default: 8000
  preservePatterns?: string[];            // regex strings; never remove matching lines
  enableStubCollapse?: boolean;           // default: false — gate for aggressive H4
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

// ─── Compression Pipeline Result (v3.1) ───────────────────────────────────────

/**
 * Result of running compression pipeline.
 * heuristics_applied: identifiers only (H2, H3, H1, H4, H5) in stable order
 * warnings: separate channel for regex compilation errors, etc.
 */
export interface CompressionPipelineResult {
  compressed: string;
  originalTokens: number;
  compressedTokens: number;
  heuristics_applied: string[];     // ['H2', 'H3'] if they ran; stable order
  removed_sections: string[];       // Detailed removal descriptions
  warnings: string[];               // e.g., "Invalid regex at pattern[0]: ..."
  mode: 'standard' | 'aggressive';
}

// ─── Internal Compression Return (v3.1) ──────────────────────────────────────

export interface CompressContextResult {
  compressed: string;
  removed: string[];
  originalTokens: number;
  compressedTokens: number;
  heuristics_applied?: string[];  // NEW v3.1: which heuristics fired
  mode?: 'standard' | 'aggressive';
}

// ─── License Data ─────────────────────────────────────────────────────────────

export interface LicenseData {
  schema_version: 1;
  tier: Tier;
  issued_at: string;          // ISO 8601
  expires_at: string;         // ISO 8601 or "never"
  license_id: string;         // short ID for support (first 8 chars of key hash)
  activated_at: string;       // ISO 8601 — when set_license was called
  valid: boolean;             // cached validation result
  validation_error?: string;  // present when valid=false
}

// ─── Usage Data ─────────────────────────────────────────────────────────────────

export interface UsageData {
  schema_version: 1;
  total_optimizations: number;
  current_period_start?: string;     // ISO 8601 — unused Phase A, ready for Phase B
  period_optimizations?: number;     // unused Phase A, ready for Phase B
  first_used_at: string;
  last_used_at: string;
  tier: Tier;
}

// ─── Optimizer Config ─────────────────────────────────────────────────────────

export interface OptimizerConfig {
  schema_version: 1;
  mode: 'manual' | 'always_on';
  threshold: number;                 // 0-100, default 60
  strictness: 'relaxed' | 'standard' | 'strict';
  auto_compile: boolean;
  default_target: OutputTarget;
  ephemeral_mode: boolean;           // true = no session persistence to disk
  max_sessions: number;              // default 200
  max_session_size_kb: number;       // default 50
  max_session_dir_mb: number;        // default 20 — absolute cap on session directory size
}

// ─── Stats Data ───────────────────────────────────────────────────────────────

export interface StatsData {
  schema_version: 1;
  scoring_version: 2;
  total_optimized: number;
  total_approved: number;
  score_sum_before: number;          // numeric pre-compile scores ONLY
  task_type_counts: Record<string, number>;
  blocking_question_counts: Record<string, number>;
  estimated_cost_savings_usd: number;
}

// ─── Stats Event (for updateStats) ───────────────────────────────────────────

export interface StatsEvent {
  type: 'optimize' | 'approve';
  score_before?: number;
  task_type?: string;
  blocking_questions?: string[];
  cost_savings_usd?: number;
}

// ─── Enforcement Result ───────────────────────────────────────────────────────

export interface EnforcementResult {
  allowed: boolean;
  enforcement: 'lifetime' | 'monthly' | 'rate' | 'always_on' | null;
  usage: UsageData;
  limits: SerializedTierLimits;       // Serialized (Infinity → null for JSON safety)
  remaining: {
    lifetime: number;
    monthly: number;
  };
  retry_after_seconds?: number;      // present ONLY when enforcement='rate'
}

// ─── Rate Limiter Interface ───────────────────────────────────────────────────

export interface RateLimiter {
  check(tier: string): { allowed: boolean; retry_after_seconds?: number };
}

// ─── Logger Interface ─────────────────────────────────────────────────────────

export interface Logger {
  debug: (requestId: string, ...args: unknown[]) => void | boolean;
  info: (requestId: string, ...args: unknown[]) => void | boolean;
  warn: (requestId: string, ...args: unknown[]) => void | boolean;
  error: (requestId: string, ...args: unknown[]) => void | boolean;
  prompt: (requestId: string, label: string, content: string) => void | boolean;
}

// ─── Execution Context ────────────────────────────────────────────────────────

export interface ExecutionContext {
  requestId: string;
  storage: StorageInterface;
  logger: Logger;
  config: OptimizerConfig;
  rateLimiter: RateLimiter;
  tier: Tier;
  // Phase B extensions (added without interface change):
  // user_id?: string;
  // api_key_hash?: string;
  // workspace_id?: string;
  // ip?: string;
}

// ─── Storage Interface (async — Phase B ready) ───────────────────────────────
// SECURITY INVARIANT: No method on this interface may throw an error that
// exposes internal file paths, stack traces, or implementation details.
// All errors must be caught internally and returned as safe defaults.

export interface StorageInterface {
  health(): Promise<'ok' | 'degraded'>;
  getUsage(): Promise<UsageData>;
  incrementUsage(): Promise<UsageData>;
  canUseOptimization(ctx: ExecutionContext): Promise<EnforcementResult>;
  isProTier(): Promise<boolean>;
  getConfig(): Promise<OptimizerConfig>;
  setConfig(config: Partial<OptimizerConfig>): Promise<OptimizerConfig>;
  saveSession(session: Session): Promise<void>;
  loadSession(id: string): Promise<Session | undefined>;
  deleteSession(id: string): Promise<void>;
  cleanupSessions(): Promise<void>;
  getStats(): Promise<StatsData>;
  updateStats(event: StatsEvent): Promise<void>;
  getLicense(): Promise<LicenseData | null>;
  setLicense(data: LicenseData): Promise<void>;
  clearLicense(): Promise<void>;
}
