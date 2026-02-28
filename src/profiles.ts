// profiles.ts — 5 frozen optimization profiles for the v3 decision engine.
// Profiles provide sensible defaults for ModelRoutingInput fields.
// Explicit user inputs ALWAYS override profile defaults.
// enterprise_safe is never auto-suggested (G5).

import type {
  OptimizationProfile,
  ReasoningComplexity,
  ModelTier,
} from './types.js';
import { RISK_ESCALATION_THRESHOLD } from './rules.js';

// ─── Profile Definition ──────────────────────────────────────────────────────

export interface ProfileSpec {
  tier: ModelTier;
  temperature: number;
  maxTokensCap: number;
  budgetSensitivity: 'low' | 'medium' | 'high';
  latencySensitivity: 'low' | 'medium' | 'high';
}

// ─── Frozen Profile Presets ──────────────────────────────────────────────────

export const PROFILES: Readonly<Record<OptimizationProfile, Readonly<ProfileSpec>>> = Object.freeze({
  cost_minimizer: Object.freeze({
    tier: 'small' as ModelTier,
    temperature: 0.3,
    maxTokensCap: 2000,
    budgetSensitivity: 'high' as const,
    latencySensitivity: 'medium' as const,
  }),
  balanced: Object.freeze({
    tier: 'mid' as ModelTier,
    temperature: 0.5,
    maxTokensCap: 4000,
    budgetSensitivity: 'medium' as const,
    latencySensitivity: 'medium' as const,
  }),
  quality_first: Object.freeze({
    tier: 'top' as ModelTier,
    temperature: 0.3,
    maxTokensCap: 8000,
    budgetSensitivity: 'low' as const,
    latencySensitivity: 'low' as const,
  }),
  creative: Object.freeze({
    tier: 'mid' as ModelTier,
    temperature: 0.9,
    maxTokensCap: 8000,
    budgetSensitivity: 'medium' as const,
    latencySensitivity: 'low' as const,
  }),
  enterprise_safe: Object.freeze({
    tier: 'top' as ModelTier,
    temperature: 0.1,
    maxTokensCap: 4000,
    budgetSensitivity: 'low' as const,
    latencySensitivity: 'low' as const,
  }),
});

// ─── Profile Suggestion (G5: deterministic mapping) ──────────────────────────

/**
 * Suggest a profile based on complexity + risk score.
 * enterprise_safe is NEVER auto-suggested (user-selected only).
 * Returns 'balanced' as fallback for unknown complexity types.
 */
export function suggestProfile(
  complexity: ReasoningComplexity,
  riskScore: number,
): OptimizationProfile {
  switch (complexity) {
    case 'simple_factual':
      return 'cost_minimizer';
    case 'analytical':
      return 'balanced';
    case 'multi_step':
      return riskScore >= RISK_ESCALATION_THRESHOLD ? 'quality_first' : 'balanced';
    case 'creative':
      return 'creative';
    case 'long_context':
      return 'balanced';
    case 'agent_orchestration':
      return riskScore >= RISK_ESCALATION_THRESHOLD ? 'quality_first' : 'balanced';
    default:
      return 'balanced';
  }
}

/**
 * Resolve a profile name, falling back to 'balanced' for invalid names.
 * Adds a decision_path entry when fallback is used.
 */
export function resolveProfile(
  profileName: string | undefined,
  decisionPath: string[],
): OptimizationProfile {
  if (!profileName) return 'balanced';

  const validProfiles: OptimizationProfile[] = [
    'cost_minimizer', 'balanced', 'quality_first', 'creative', 'enterprise_safe',
  ];

  if (validProfiles.includes(profileName as OptimizationProfile)) {
    return profileName as OptimizationProfile;
  }

  // Invalid profile → fallback to balanced + decision_path warning
  decisionPath.push(`profile_fallback=${profileName}→balanced`);
  return 'balanced';
}
