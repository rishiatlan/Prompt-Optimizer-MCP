# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

An MCP (Model Context Protocol) server that optimizes prompts for maximum impact and minimum cost. Acts as a **deterministic prompt compiler + contract enforcer** — turns raw user intent into a structured, constrained, reviewable prompt bundle.

**v2.1: Production-ready freemium product** with 3-tier access (Free/Pro $4.99\/mo/Power $9.99\/mo), multi-LLM output (Claude/OpenAI/generic), async StorageInterface for Phase B migration, rate limiting, monthly usage metering with calendar-month reset, Ed25519 offline license activation, and 11 tools.

**Zero LLM calls inside the MCP.** All intelligence comes from the host Claude. The MCP provides structure, rules, and discipline.

## Build & Test

```bash
npm run build    # tsc → dist/
npm test         # node --test dist/test/*.test.js (7 test files, 98 tests)
npm run start    # node dist/src/index.js
```

**ESM module** — `"type": "module"` in package.json. All imports use `.js` extensions. `rootDir` is `"."` (both `src/` and `test/` compile to `dist/`).

## Distribution

Published to npm as `claude-prompt-optimizer-mcp`. End users install via `npx`.

- `bin/cli.js` is the shebang entry point, importing `dist/src/index.js`
- `package.json` has `bin` pointing to `bin/cli.js`, `files` whitelist ships only `dist/`, `bin/`, `README.md`, `LICENSE`
- `prepublishOnly` script runs `npm run build` before publish

## Environment Variables

| Var | Default | Purpose |
|-----|---------|---------|
| `PROMPT_OPTIMIZER_PRO` | unset | Set to `true` to enable pro tier (env var override). Tier priority: license key > env var > default free. |
| `PROMPT_OPTIMIZER_LOG_LEVEL` | `info` | Log verbosity: debug, info, warn, error |
| `PROMPT_OPTIMIZER_LOG_PROMPTS` | unset (false) | Set to `true` to enable raw prompt logging. **Never enable in shared environments.** |

## Architecture

```
User prompt → Host Claude → [calls MCP tools] → Deterministic analysis
                                                   ↓
                                              PreviewPack returned
                                                   ↓
                                           Claude presents to user
                                                   ↓
                                           User approves/refines
                                                   ↓
                                           Claude executes with
                                           compiled prompt as guide
```

### Phase A / Phase B Split

- **Phase A (current):** Local file-based storage (`~/.prompt-optimizer/`), env var tier override, instance-scoped rate limiting
- **Phase B (future):** Cloudflare Worker + Supabase + Stripe. Same `StorageInterface`, same tool contracts, only implementation swaps

The async `StorageInterface` and `ExecutionContext` pattern ensure Phase B requires zero tool handler changes. Enforced by `test/contracts.test.ts`.

## 11 MCP Tools

| # | Tool | Free/Metered | Purpose |
|---|------|-------------|---------|
| 1 | `optimize_prompt` | **Metered** | Main entry: analyze → score → compile → estimate cost → return PreviewPack |
| 2 | `refine_prompt` | **Metered** | Iterative: answer questions, add edits → updated PreviewPack |
| 3 | `approve_prompt` | Free | Sign-off gate: returns final compiled prompt + quality_score_before |
| 4 | `estimate_cost` | Free | Multi-provider token + cost estimator (Anthropic, OpenAI, Google) |
| 5 | `compress_context` | Free | Prune irrelevant context, report token savings |
| 6 | `check_prompt` | Free | Lightweight pass/fail + score + top 2 issues |
| 7 | `configure_optimizer` | Free | Set mode, threshold, strictness, target, ephemeral mode, session limits |
| 8 | `get_usage` | Free | Usage count, limits, remaining, tier info |
| 9 | `prompt_stats` | Free | Aggregates: total, avg score, top task types, cost savings |
| 10 | `set_license` | Free | Activate Pro license key (Ed25519 offline validation) |
| 11 | `license_status` | Free | Check license status, tier, expiry. Shows purchase link if no license. |

### Output Targets

- **claude** (default): XML-tagged (`<role>`, `<goal>`, `<constraints>`, etc.)
- **openai**: System/user message split (`[SYSTEM]...[USER]...`)
- **generic**: Markdown with `## Headers`

## Build-Mode Invariants

These are immutable coding rules. If implementation drifts from any, it's a bug.

| ID | Rule | Enforcement |
|----|------|-------------|
| I1 | Deterministic ordering | `src/sort.ts` — all array fields sorted consistently |
| I2 | One response envelope | ALL responses include `request_id` (success AND error) |
| I3 | Metering-after-success | `let success = false; try { ...; success = true; } finally { if (success) increment; }` |
| I4 | Rate limit centralized | Only inside `canUseOptimization(ctx)` — never in tool handlers |
| I5 | Degraded health explicit | `"storage_health": "degraded"` in metered responses when storage unhealthy |

## File Roles

| File | Role |
|------|------|
| `src/index.ts` | Entry point — CLI flags, MCP server + stdio transport, wires storage + rate limiter |
| `src/tools.ts` | 11 MCP tool registrations with Zod schemas, freemium gate, ExecutionContext, error handling |
| `src/types.ts` | All interfaces: TierLimits, PLAN_LIMITS, PreviewPack, ExecutionContext, StorageInterface, OutputTarget, LicenseData |
| `src/license.ts` | Ed25519 offline license key validation (public key only, zero npm deps) |
| `src/analyzer.ts` | Intent decomposition: raw prompt → IntentSpec. Three-layer task detection. |
| `src/compiler.ts` | Multi-LLM compilation: IntentSpec → claude/openai/generic output with format_version |
| `src/estimator.ts` | Multi-provider cost estimation (Anthropic, OpenAI, Google), target-aware recommendations |
| `src/scorer.ts` | Quality scoring (0-100, 5 dimensions × 20 points, scoring_version: 2). `generateChecklist()` for structural coverage. |
| `src/rules.ts` | 10 deterministic ambiguity detection rules with `applies_to` field |
| `src/templates.ts` | `Record<TaskType, string>` for roles and workflows |
| `src/session.ts` | Async session management delegating to StorageInterface |
| `src/logger.ts` | Structured logging with levels, request ID correlation, prompt logging gate |
| `src/rateLimit.ts` | `LocalRateLimiter` — instance-scoped, tier-keyed sliding window |
| `src/sort.ts` | Deterministic ordering helpers: CHECKLIST_ORDER, sortCountsDescKeyAsc, sortIssues, sortCostEntries |
| `src/storage/interface.ts` | StorageInterface type, defaults (DEFAULT_CONFIG, DEFAULT_USAGE, DEFAULT_STATS) |
| `src/storage/localFs.ts` | File-based StorageInterface implementation (`~/.prompt-optimizer/`) |
| `src/storage/index.ts` | Re-export — Phase B swaps one line |

## Test Files

| File | Tests |
|------|-------|
| `test/scorer.test.ts` | 100/100 ceiling, checklist generation, dimension boundaries, preservation bonus |
| `test/compiler.test.ts` | XML/openai/generic output, format_version, blocking questions exclusion |
| `test/storage.test.ts` | CRUD, session lifecycle, path traversal, session cleanup, stats |
| `test/freemium.test.ts` | Lifetime gate, pro bypass, metering-after-success, rate limiter, PLAN_LIMITS |
| `test/contracts.test.ts` | Output shape freeze (PreviewPack, CostEstimate, LicenseData), deterministic ordering |
| `test/security.test.ts` | Input hardening, session ID sanitization, no-throw invariant, UUID format |
| `test/license.test.ts` | Ed25519 validation, storage CRUD, tier priority chain, file permissions |

## Key Type Contracts

### TierLimits & PLAN_LIMITS
```typescript
{ lifetime: number, monthly: number, rate_per_minute: number, always_on: boolean }
// free:  { lifetime: 10,       monthly: 10,       rate_per_minute: 5,  always_on: false }
// pro:   { lifetime: Infinity, monthly: 100,      rate_per_minute: 30, always_on: false }
// power: { lifetime: Infinity, monthly: Infinity,  rate_per_minute: 60, always_on: true }
```

### ExecutionContext
```typescript
{ requestId, storage, logger, config, rateLimiter, tier }
// Phase B adds: user_id?, api_key_hash?, workspace_id?, ip?
```

### EnforcementResult
```typescript
{ allowed, enforcement: 'lifetime'|'monthly'|'rate'|'always_on'|null, usage, limits, remaining, retry_after_seconds? }
```

### LicenseData
```typescript
{ schema_version: 1, tier, issued_at, expires_at, license_id, activated_at, valid, validation_error? }
```

## License System

- **Ed25519 asymmetric signatures** — public key in `src/license.ts`, private key never in repo
- **License key format:** `po_pro_<base64url({ payload, signature_hex })>`
- **Payload:** `{ tier, issued_at, expires_at, license_id }` — no PII, no email
- **Tier priority chain:** license key (cryptographically verified) > `PROMPT_OPTIMIZER_PRO` env var > default free
- **`getLicense()` re-checks expiry** on every read; marks `valid=false` + `validation_error='expired'` if newly expired
- **`setLicense()` sets chmod 600** on POSIX (best-effort, skip on Windows)
- **Gate responses** include `purchase_url` + `next_step` when tier limit is hit (not on rate limits)
- **Production key:** Replace `PRODUCTION_PUBLIC_KEY_PEM` placeholder before first npm publish

## Scoring

- **scoring_version: 2** — max 100/100 achievable (v1 capped at 96)
- 5 dimensions × 20 points: Specificity, Constraints, Structure, Efficiency, Context Fit
- Constraints: +2 for preservation instructions ("preserve", "keep existing", "maintain")
- Efficiency: +2 bonus for concise prompts (<1000 tokens + no repetition)
- `generateChecklist()` returns 9-item structural coverage (separate from numeric score)

## Common Pitfalls

- **Adding a new TaskType**: Update `types.ts`, `templates.ts` (both ROLES and WORKFLOWS), `analyzer.ts`, `estimator.ts`, `analyzer.ts` `extractDefinitionOfDone`
- **Topic-vs-task confusion**: "Write a post about my MCP" must classify as `writing`. Intent-first opener handles this.
- **scope_explosion lookahead**: Uses 50-char window. Test with "refactor all the code" (trigger) vs "pass all existing tests in auth.test.ts" (no trigger).
- **Phase B migration**: Only `storage/index.ts` export changes. All tool handler code, test contracts, and interfaces stay identical.
- **Metering integrity**: The `success = true` line in tools.ts MUST be after ALL pipeline work. Any throw before it prevents metering.
- **Rate limiter isolation**: `LocalRateLimiter` is instance-scoped. Never use global mutable state for rate limiting.
- **`canUseOptimization` uses `ctx.tier`**: Tier comes from ExecutionContext (set by tools layer), NOT from storage. This is correct for Phase B where tier comes from API key auth.
- **License key validation is synchronous**: `validateLicenseKey()` is a pure function (no I/O). Storage methods are async but validation itself is sync crypto.
- **Production key**: `PRODUCTION_PUBLIC_KEY_PEM` contains the live Ed25519 public key. Regenerating the keypair (scripts/keygen.mjs init) invalidates ALL existing license keys.

## Breaking Changes (v1 → v2)

- `quality_after` → `compilation_checklist` (CompilationChecklist, not a numeric score)
- `PreviewPack` now includes `request_id`, `target`, `format_version: 1`, `scoring_version: 2`, `storage_health?`
- All responses include `request_id` (success and error)
- `CostEstimate.costs` now includes OpenAI + Google models (was Anthropic-only)
- `compilePrompt()` takes `target: OutputTarget` parameter
- 4 new tools: `check_prompt`, `configure_optimizer`, `get_usage`, `prompt_stats`
- Sessions backed by async StorageInterface (was sync in-memory Map)
- Scoring max changed from 96 to 100 (scoring_version: 2)
