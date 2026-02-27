// storage/interface.ts — Storage interface contract + defaults + plan limits.
// Phase B swaps implementation (localFs → supabaseKv) without changing this file.

import type {
  OptimizerConfig,
  UsageData,
  StatsData,
  OutputTarget,
} from '../types.js';

// ─── Secure Defaults ──────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: OptimizerConfig = {
  schema_version: 1,
  mode: 'manual',             // never always_on by default (free tier can't use it)
  threshold: 60,
  strictness: 'standard',
  auto_compile: true,
  default_target: 'claude' as OutputTarget,
  ephemeral_mode: false,       // false = sessions persist. true = ephemeral only.
  max_sessions: 200,
  max_session_size_kb: 50,
  max_session_dir_mb: 20,     // absolute cap — prevents disk abuse
};

export const DEFAULT_USAGE: UsageData = {
  schema_version: 1,
  total_optimizations: 0,
  first_used_at: '',
  last_used_at: '',
  tier: 'free',
};

export const DEFAULT_STATS: StatsData = {
  schema_version: 1,
  scoring_version: 2,
  total_optimized: 0,
  total_approved: 0,
  score_sum_before: 0,
  task_type_counts: {},
  blocking_question_counts: {},
  estimated_cost_savings_usd: 0,
};

// Re-export the interface and types from types.ts for convenience
export type {
  StorageInterface,
  OptimizerConfig,
  UsageData,
  StatsData,
  EnforcementResult,
  TierLimits,
  ExecutionContext,
  RateLimiter,
  StatsEvent,
  Session,
  Tier,
  LicenseData,
} from '../types.js';

export { PLAN_LIMITS } from '../types.js';
