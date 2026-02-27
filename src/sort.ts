// sort.ts — Deterministic ordering helpers for all response arrays.
// Used everywhere to prevent snapshot flakiness, noisy diffs, and client rendering churn.

import type { ChecklistItem, RuleResult, ModelCost } from './types.js';

// ─── Checklist Canonical Order ────────────────────────────────────────────────

export const CHECKLIST_ORDER = [
  'Role',
  'Goal',
  'Definition of Done',
  'Constraints',
  'Workflow',
  'Output Format',
  'Uncertainty Policy',
  'Audience',
  'Platform Guidelines',
] as const;

/** Sort checklist items in canonical order. */
export function sortChecklist(items: ChecklistItem[]): ChecklistItem[] {
  return [...items].sort((a, b) => {
    const ai = CHECKLIST_ORDER.indexOf(a.name as typeof CHECKLIST_ORDER[number]);
    const bi = CHECKLIST_ORDER.indexOf(b.name as typeof CHECKLIST_ORDER[number]);
    // Unknown items go to the end, sorted alphabetically
    const aIdx = ai === -1 ? CHECKLIST_ORDER.length : ai;
    const bIdx = bi === -1 ? CHECKLIST_ORDER.length : bi;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.name.localeCompare(b.name);
  });
}

// ─── Count-based Sorting ──────────────────────────────────────────────────────

export interface CountEntry {
  key: string;
  count: number;
}

/** Sort a Record<string, number> by count desc, then key asc. Returns top N entries. */
export function sortCountsDescKeyAsc(
  record: Record<string, number>,
  limit: number = Infinity,
): CountEntry[] {
  return Object.entries(record)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.key.localeCompare(b.key);
    })
    .slice(0, limit);
}

// ─── Issue Sorting ────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = { blocking: 0, non_blocking: 1 };

/** Sort issues by severity desc (blocking first), then rule_name asc. */
export function sortIssues(issues: RuleResult[]): RuleResult[] {
  return [...issues].sort((a, b) => {
    const aSev = SEVERITY_ORDER[a.severity] ?? 2;
    const bSev = SEVERITY_ORDER[b.severity] ?? 2;
    if (aSev !== bSev) return aSev - bSev;
    return a.rule_name.localeCompare(b.rule_name);
  });
}

// ─── Cost Entry Sorting ───────────────────────────────────────────────────────

/** Sort cost entries by provider asc, then model asc. */
export function sortCostEntries(costs: ModelCost[]): ModelCost[] {
  return [...costs].sort((a, b) => {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    return a.model.localeCompare(b.model);
  });
}
