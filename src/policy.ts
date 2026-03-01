// policy.ts — Pure policy evaluation module for v3.3.0.
// No MCP/tools dependency. All functions are pure and testable directly.
// Evaluates already-computed RuleResult[] — does NOT re-evaluate regexes.

import { createHash } from 'node:crypto';
import type { RuleResult, PolicyViolation } from './types.js';

// ─── Strictness Thresholds (canonical source) ───────────────────────────────
// Moved from tools.ts. Re-exported for backward compatibility.

export const STRICTNESS_THRESHOLDS: Record<string, number> = {
  relaxed: 40,
  standard: 60,
  strict: 75,
} as const;

// ─── Policy Evaluation ──────────────────────────────────────────────────────

/**
 * Evaluate policy violations from already-computed rule results.
 * Returns violations only when policy_mode === 'enforce'.
 * Includes both built-in and custom BLOCKING rules.
 * Violations sorted by rule_id for determinism.
 */
export function evaluatePolicyViolations(
  ruleResults: RuleResult[],
  config: { policy_mode?: string },
): PolicyViolation[] {
  if (config.policy_mode !== 'enforce') return [];

  const violations: PolicyViolation[] = [];

  for (const result of ruleResults) {
    if (result.triggered && result.severity === 'blocking') {
      violations.push({
        rule_id: result.rule_name,
        description: result.message,
        severity: result.severity,
        risk_dimension: result.risk_elevation || undefined,
      });
    }
  }

  // Sort by rule_id for determinism
  violations.sort((a, b) => a.rule_id.localeCompare(b.rule_id));
  return violations;
}

// ─── Risk Threshold Check ───────────────────────────────────────────────────

export interface RiskThresholdCheck {
  exceeded: boolean;
  score: number;
  threshold: number;
}

/**
 * Check if risk score exceeds the strictness threshold.
 * Semantics (LOCKED): score >= threshold → exceeded (blocked).
 */
export function checkRiskThreshold(
  riskScore: number,
  strictness: string,
): RiskThresholdCheck {
  const threshold = STRICTNESS_THRESHOLDS[strictness] ?? STRICTNESS_THRESHOLDS.standard;
  return {
    exceeded: riskScore >= threshold,
    score: riskScore,
    threshold,
  };
}

// ─── Policy Enforcement Summary ─────────────────────────────────────────────

export interface PolicyEnforcementSummary {
  mode: string;
  violations: PolicyViolation[];
  risk_threshold_exceeded: boolean;
  blocked: boolean;
}

/**
 * Build a policy enforcement summary for pre_flight responses.
 */
export function buildPolicyEnforcementSummary(
  violations: PolicyViolation[],
  riskCheck: RiskThresholdCheck,
): PolicyEnforcementSummary {
  return {
    mode: 'enforce',
    violations,
    risk_threshold_exceeded: riskCheck.exceeded,
    blocked: violations.length > 0 || riskCheck.exceeded,
  };
}

// ─── Policy Hash ────────────────────────────────────────────────────────────

/**
 * Calculate a deterministic policy hash for reproducibility.
 * SHA-256 of builtInHash + customHash + policyMode + strictness.
 * Answers: "prove this export was produced under policy X."
 */
export function calculatePolicyHash(opts: {
  builtInRuleSetHash: string;
  customRuleSetHash: string;
  policyMode: string;
  strictness: string;
}): string {
  const input = `${opts.builtInRuleSetHash}\n${opts.customRuleSetHash}\n${opts.policyMode}\n${opts.strictness}`;
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
