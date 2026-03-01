# Phase 2: Custom Rules — Approval Plan

**Status:** Ready for review + overrides
**Date:** 2026-03-01
**Dependency:** Phase 1 (Session History) ✅ COMPLETE
**Test Target:** 20 high-signal tests (from 85-test global target)

---

## Executive Summary

Phase 2 adds enterprise-grade custom rule injection without exposing rule mutations via tools. Rules are stored locally in a file-based JSON config, versioned alongside sessions, and hashed for reproducibility (Phase 3 prep).

**User Constraints Applied (LOCKED):**
- ❌ NO `configure_custom_rules` tool
- ✅ File-based only: `~/.prompt-optimizer/custom-rules.json`
- ⬆️ Hard cap: **25 custom rules** (was 10)
- Performance safeguards: 100ms regex timeout, 200 char max pattern
- Deterministic ordering: sorted by `id`
- CLI validator: `prompt-lint --validate-custom-rules` (read-only, no mutations)

---

## What Gets Built

### 1. Custom Rules File Format

**Location:** `~/.prompt-optimizer/custom-rules.json`

**Schema:**
```json
{
  "schema_version": 1,
  "created_at": 1709234400,
  "rules": [
    {
      "id": "async_error_check",
      "description": "Async functions must have try/catch blocks",
      "pattern": "async.*function|await.*\\?",
      "negative_pattern": "try\\s*\\{.*catch",
      "applies_to": "code",
      "severity": "BLOCKING",
      "risk_dimension": "constraint",
      "risk_weight": 15
    },
    {
      "id": "token_budget",
      "description": "Response size must fit within specified token budget",
      "pattern": "tokens?|budget|limit",
      "applies_to": "all",
      "severity": "NON-BLOCKING",
      "risk_dimension": "underspec",
      "risk_weight": 10
    }
  ]
}
```

**Constraints:**
- `id`: snake_case, max 64 chars, regex: `^[a-z][a-z0-9_]{0,63}$` (stored as-is; outputs namespaced as `custom_{id}`)
- `description`: max 200 chars (used in validation output + export metadata)
- `pattern`: JavaScript regex string, max 500 chars (escaped, validated)
- `negative_pattern`: optional regex (max 500 chars), must NOT match for rule to trigger; both regexes tested against same text
- `applies_to`: enum `'code'` | `'prose'` | `'all'` (determines which TaskTypes it applies to)
- `severity`: enum `'BLOCKING'` | `'NON-BLOCKING'` (capitalized in file)
- `risk_dimension`: enum `'hallucination'` | `'constraint'` | `'underspec'` | `'scope'` (which dimension the weight targets)
- `risk_weight`: 1–25 (integer, contributes to RiskDimensions via RuleResult.custom_weight metadata)
- Max **25 custom rules per config** (hard cap)
- Regex safety: try/catch compile, skip-on-error, warn on failure (both pattern and negative_pattern); invalid regex → rule skipped with warning
- Deterministic ordering: sorted by `id` (immutable in output, rule-set hash input)
- Application order: custom rules run AFTER built-in rules
- Decision path cap: max 5 custom rule annotations (determinism)

---

## Files to Create

### `src/customRules.ts` (NEW)

**Purpose:** Load, validate, apply custom rules.

**Exports:**
```typescript
export class CustomRulesManager {
  constructor(dataDir?: string)

  // Load + validate custom rules from disk
  async loadRules(): Promise<CustomRule[]>

  // Validate single rule (pattern, weight, etc.)
  validateRule(rule: any): { valid: boolean; errors: string[] }

  // Apply rule to prompt (respects timeout + char limits)
  async evaluateRule(rule: CustomRule, prompt: string, taskType: TaskType): Promise<RuleMatch | null>

  // Get all applicable rules for a task type (filtered + sorted by id)
  async getRulesForTask(taskType: TaskType): Promise<CustomRule[]>
}

export const customRules = new CustomRulesManager()
```

**Key Methods:**
- `loadRules()` → reads custom-rules.json, validates all rules, returns sorted array (or empty if file missing)
- `validateRule()` → checks pattern syntax, weight bounds, applies_to membership
- `evaluateRule()` → compiles regex, runs with 100ms timeout, returns match or null
- `getRulesForTask()` → filters by applies_to, returns deterministic order (sorted by id)

---

### `test/customRules.test.ts` (NEW)

**Coverage:** 20 high-signal tests

| Category | Tests | Coverage |
|----------|-------|----------|
| File I/O | 3 | Load/validate/missing file, JSON parse errors |
| Schema Validation | 4 | Rule ID prefix, weight bounds, pattern syntax, applies_to membership |
| Regex Safety | 4 | Pattern compilability (try/catch), bad patterns skipped w/ warning, 500-char limit, pattern length validation |
| Determinism | 4 | Sorting by id, stable application order, max 5 decision_path annotations, custom_rule_set_hash consistency |
| Integration | 3 | Export metadata (custom_rules_applied + custom_rule_set_hash), apply to task types, rule filtering |
| Edge Cases | 2 | Empty rules file, max 25 rules enforcement, concurrent access |

**Test Structure:**
```typescript
// Isolated temp directory per test (like Phase 1)
const tempDir = tmpdir() + '/custom-rules-test-' + randomUUID()
const manager = new CustomRulesManager(tempDir)

// Example tests:
- Load rules from valid JSON file
- Reject rule with id not starting with 'custom_'
- Reject rule with pattern >200 chars
- Enforce 100ms timeout on slow regex
- Verify rules sorted by id after load
- Check custom_rules_applied populated in export_session metadata
```

---

## Files to Modify

### `src/types.ts`

**Add Types:**
```typescript
export interface CustomRule {
  id: string;                          // snake_case, max 64 chars, regex: ^[a-z][a-z0-9_]{0,63}$
  description: string;                 // max 200 chars
  pattern: string;                     // JavaScript regex string, max 500 chars
  negative_pattern?: string;           // optional exclusion regex, max 500 chars
  applies_to: 'code' | 'prose' | 'all'; // which task type groups this applies to
  severity: 'BLOCKING' | 'NON-BLOCKING'; // capitalized in file
  risk_dimension: 'hallucination' | 'constraint' | 'underspec' | 'scope'; // which RiskDimension to target
  risk_weight: number;                 // 1-25
}

export interface CustomRulesConfig {
  schema_version: 1;
  created_at: number;                  // Unix timestamp
  rules: CustomRule[];
}

export interface RuleMatch {
  rule_id: string;
  matched: boolean;
  description: string;                 // From custom rule description field
  severity: 'BLOCKING' | 'NON-BLOCKING';
  custom_weight?: number;              // For custom rules only; never mutates RISK_WEIGHTS
  risk_dimension?: 'hallucination' | 'constraint' | 'underspec' | 'scope'; // Which dimension this contributes to
  error?: string;                      // If regex compile failed (skip-on-error pattern)
}
```

### `src/rules.ts`

**Modify:**
- Import `customRules` manager
- Add `applyCustomRules()` function that:
  - Loads custom rules for the task type
  - Evaluates each rule against the prompt
  - Returns array of RuleMatch results
  - Integrates into existing `computeRiskScore()` pipeline

**Integration Point:**
```typescript
// In computeRiskScore:
const builtInMatches = evaluateBuiltInRules(prompt, taskType)
const customMatches = await customRules.evaluateAllForTask(prompt, taskType)
const allMatches = [...builtInMatches, ...customMatches]
// Risk score incorporates both
```

### `src/sessionHistory.ts`

**Modify `exportSession()`:**
- Load custom rules at export time
- Determine which custom rules applied to the prompt
- Add `metadata.custom_rules_applied: string[]` (rule IDs that matched)
- Add `metadata.custom_rule_set_hash: string` (Phase 3 prep: SHA256 of custom rules)

```typescript
async exportSession(sessionId: string, ...): Promise<SessionExport | null> {
  // ... existing code ...

  const applicableRules = await customRules.getRulesForTask(session.intent_spec.task_type)
  const customRulesApplied = applicableRules
    .filter(r => await customRules.evaluateRule(r, session.raw_prompt, session.intent_spec.task_type))
    .map(r => r.id)

  // Phase 3 prep: calculate custom rule-set hash (deterministic, exact format)
  // Hash input: sorted by id asc, each rule as: id\npattern\nnegative_pattern\napplies_to\nseverity\nrisk_dimension\nrisk_weight
  const customRuleSetHash = applicableRules.length > 0
    ? (() => {
        const sorted = [...applicableRules].sort((a, b) => a.id.localeCompare(b.id))
        const hashInput = sorted.map(r =>
          `${r.id}\n${r.pattern}\n${r.negative_pattern || ''}\n${r.applies_to}\n${r.severity}\n${r.risk_dimension}\n${r.risk_weight}`
        ).join('\n')
        return createHash('sha256').update(hashInput, 'utf8').digest('hex')
      })()
    : ''

  return {
    // ... existing fields ...
    metadata: {
      // ... existing fields ...
      custom_rules_applied: customRulesApplied,
      custom_rule_set_hash: customRuleSetHash,
    },
  }
}
```

### `src/lint-cli.ts`

**Add Flag:** `--validate-custom-rules`

```bash
prompt-lint --validate-custom-rules
```

**Output:**
```json
{
  "valid": true,
  "rule_count": 3,
  "validation_errors": [],
  "validation_warnings": [],
  "storage_path": "~/.prompt-optimizer/custom-rules.json"
}
```

**Behavior:**
- Read custom-rules.json
- Validate all rules:
  - ID format (snake_case, max 64 chars, regex: `^[a-z][a-z0-9_]{0,63}$`)
  - Description max 200 chars
  - Pattern compilability (both pattern and negative_pattern), max 500 chars each
  - Weight bounds (1-25, integer)
  - applies_to membership (code | prose | all)
  - severity membership (BLOCKING | NON-BLOCKING)
  - risk_dimension membership (hallucination | constraint | underspec | scope)
- Try/catch regex compile for both pattern and negative_pattern: if either fails, warn + skip rule (don't error)
- Report validation_errors (one per line, actionable)
- Report validation_warnings (e.g., "Rule X: pattern failed to compile, will be skipped at runtime")
- Exit code 0 if valid (even with warnings), 1 if critical errors
- **Read-only** (no file mutations, no auto-fix, no rewrite)
- **No runtime timeout claims** — safety enforced via try/catch only

### `test/contracts.test.ts`

**Add Tests:**
- Validate CustomRule interface shape
- Ensure custom_rules_applied is always array (even if empty)
- Verify rule ID format in exports
- Check deterministic ordering in metadata

---

## Plan-Level Guardrails (LOCKED)

These constraints ensure Phase 2 integrates cleanly with Phase 1 and sets up Phase 3:

1. **CLI Validation Only**
   - `src/lint-cli.ts` — validation output only, NO writes, NO auto-fix, NO rewrite
   - Read custom-rules.json, report errors/warnings, exit code 0/1
   - Immutable output (no side effects)

2. **Integration Order**
   - Custom rules run AFTER built-in rules in risk scoring
   - Custom rule IDs always prefixed `custom_` in outputs (collision safety)
   - Decision path includes custom rule annotations (capped at max 5 for determinism)

3. **Weight Handling**
   - Keep `RISK_WEIGHTS` untouched (built-in rules only)
   - Custom rule weights passed via `RuleMatch.custom_weight` metadata
   - Prevents mixing custom weights with built-in dimensions

4. **Determinism + Ordering**
   - Rules sorted by ID: stable, consistent, auditable
   - Custom rule-set hash included in export metadata (Phase 3 prep)
   - Decision path capped: max 5 custom rule annotations per session

5. **Storage Path Alignment**
   - NO new subdirectories under `~/.prompt-optimizer/`
   - Custom rules at: `~/.prompt-optimizer/custom-rules.json` (same level as config.json, usage.json)
   - Sessions remain at: `~/.prompt-optimizer/session-{id}.json` (NOT sessions/ subdir)

---

## User Decision Points

## Decision Points: User Overrides Applied ✅

### 1. File Location — ✅ APPROVED
```
✅ ~/.prompt-optimizer/custom-rules.json (not a new subdir)
```

### 2. Rule Limit — ✅ APPROVED
```
✅ Hard cap: 25 custom rules per config
```

### 3. Regex Safety — ✅ APPROVED WITH CHANGE
```
❌ DROP: 100ms runtime timeout (can't enforce deterministically without worker threads/new deps)
✅ KEEP: Length cap (raised 200 → 500 chars)
✅ ADD: Try/catch compile + skip-on-error + warnings (no timeout claim)
```
**Approach:** Pattern compilation failures are caught, rule skipped with warning in validation output, no runtime timeout guarantee.

### 4. CLI Flag Name — ✅ APPROVED
```
✅ prompt-lint --validate-custom-rules
```

### 5. Export Field Name — ✅ APPROVED
```
✅ custom_rules_applied: string[] (rule IDs that matched)
✅ custom_rule_set_hash: string (Phase 3 prep)
```

---

## All Constraints LOCKED ✅

Plan-level guardrails (above) are immutable. All decision points approved. Ready to implement.

---

## Integration with Other Phases

### Phase 3 (Reproducibility)
- Custom rule hashes will be included in rule-set hash calculation
- Each custom rule ID + pattern → SHA256 digest
- Sorted by ID for determinism

### Phase 1 (Session History) — Already Done
- `export_session` metadata will include `custom_rules_applied: string[]`
- Uses custom rules manager to evaluate which rules matched

---

## Success Criteria

- [ ] CustomRulesManager loads + validates JSON correctly
- [ ] ID format enforced (snake_case, max 64 chars, regex: `^[a-z][a-z0-9_]{0,63}$`)
- [ ] Description max 200 chars enforced
- [ ] Pattern + negative_pattern both validated (try/catch), max 500 chars each
- [ ] Bad regex patterns caught (try/catch), skipped with warning, don't crash
- [ ] Weight bounds enforced (1-25, integer)
- [ ] applies_to enum enforced (code | prose | all)
- [ ] severity enum enforced (BLOCKING | NON-BLOCKING)
- [ ] risk_dimension enum enforced (hallucination | constraint | underspec | scope)
- [ ] Negative pattern exclusion logic: rule triggers only if pattern matches AND negative_pattern does NOT match
- [ ] Max 25 rules enforced (test rejects 26th rule)
- [ ] Rules sorted by ID in all outputs
- [ ] Rule-set hash calculated with exact format: id\npattern\nneg_pattern\napplies_to\nseverity\nrisk_dimension\nweight, sorted by id, SHA-256 UTF-8 hex lowercase
- [ ] Custom rules run AFTER built-in rules in risk scoring
- [ ] Custom rule weights passed via `custom_weight` metadata + `risk_dimension` to RuleResult (not RISK_WEIGHTS)
- [ ] `--validate-custom-rules` CLI flag works, read-only (no writes, no auto-fix)
- [ ] Decision path capped at max 5 custom rule annotations
- [ ] Export metadata includes `custom_rules_applied` array + `custom_rule_set_hash` hash
- [ ] All 20 tests pass
- [ ] No new mutations via tools (file-based only)
- [ ] Storage path alignment: custom-rules.json at ~/.prompt-optimizer/ (not subdir)
- [ ] Phase 3 (rule-set hash formalization) ready for integration

---

## Implementation Order

1. Create `src/customRules.ts` with CustomRulesManager (load, validate, apply, hash calculation)
2. Create `test/customRules.test.ts` with 20 high-signal tests
3. Add CustomRule + CustomRulesConfig types to `src/types.ts`
4. Integrate with `src/rules.ts`: apply custom rules AFTER built-in, pass custom_weight + risk_dimension to RuleResult
5. Modify `src/sessionHistory.ts`: populate `custom_rules_applied` + `custom_rule_set_hash` with deterministic hash
6. Add `--validate-custom-rules` flag to `src/lint-cli.ts` (validation-only, no mutations)
7. Add CustomRule shape + hash format tests to `test/contracts.test.ts`
8. Verify all 573 tests pass (553 Phase 1 + 20 new)
9. Create dev/v3.2.1-phase-2 branch
10. Commit + push

---

## Status: APPROVED ✅ READY FOR IMPLEMENTATION

All decision points locked. All plan-level guardrails confirmed. Phase 2 is ready to implement.

**Next Command:** "Implement Phase 2" → I will:
1. Create src/customRules.ts + test/customRules.test.ts
2. Modify src/types.ts, src/rules.ts, src/sessionHistory.ts, src/lint-cli.ts
3. Add integration tests to test/contracts.test.ts
4. Verify all 573 tests pass (553 Phase 1 + 20 new)
5. Create dev/v3.2.1-phase-2 branch + commit + push
