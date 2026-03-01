# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

**Prompt Control Plane** — a deterministic prompt governance engine for LLM applications. Scoring, policy enforcement, config locking, and tamper-evident auditing of AI prompts. Acts as a **deterministic prompt compiler + contract enforcer + governance layer** — turns raw user intent into a structured, constrained, reviewable prompt bundle. Ships as an MCP server, programmatic API, CLI linter (`prompt-lint`), and GitHub Action.

**v4.0.0: Enterprise-ready governance product (Prompt Control Plane)** with 4-tier access (Free/Pro ₹499\/mo/Power ₹899\/mo/Enterprise custom), multi-LLM output (Claude/OpenAI/generic), async StorageInterface for Phase B migration, rate limiting, monthly usage metering with calendar-month reset, Ed25519 offline license activation, 19 tools, programmatic API (`import { optimize }`), dual entry points (API + MCP server), CLI linter (`prompt-lint`), GitHub Action, **reasoning complexity classifier**, **5 optimization profiles**, **deterministic model routing with decision_path audit trail**, **dimensional risk scoring**, **Perplexity support** (recommendation-only), **smart compression pipeline (H1-H5 heuristics)**, **zone scanner**, **preserve patterns**, **tool pruning engine**, **pre-flight deltas**, **multi-page docs site with dark/light mode**, **custom rules** (`~/.prompt-control-plane/custom-rules/`), **reproducible session exports** (auto-calculated `rule_set_hash` + `rule_set_version` + `risk_score`), **policy enforcement mode** (advisory/enforce with BLOCKING rule gating + risk threshold), **tamper-evident audit logging** (local JSONL, SHA-256 hash chain, no prompt content), **config lock mode** (passphrase-protected, audit-logged), and **session lifecycle management** (delete, purge with dry_run, retention policy).

**Zero LLM calls inside the MCP.** All intelligence comes from the host Claude. The MCP provides structure, rules, and discipline.

## Build & Test

```bash
npm run build    # tsc → dist/
npm test         # node --test dist/test/*.test.js (32 test files, ~676 tests)
npm run start    # node dist/src/index.js
```

**ESM module** — `"type": "module"` in package.json. All imports use `.js` extensions. `rootDir` is `"."` (both `src/` and `test/` compile to `dist/`).

## Distribution

Published to npm as `claude-prompt-optimizer-mcp`. Four install channels:

| Channel | Command |
|---------|---------|
| **MCP Config** (recommended) | Add JSON to `.mcp.json` / `claude_desktop_config.json` |
| **npx** | `npx -y claude-prompt-optimizer-mcp` |
| **npm global** | `npm install -g claude-prompt-optimizer-mcp` |
| **curl** | `curl -fsSL .../install.sh \| bash` |

**Dual entry points (ESM-only):**
- `import { optimize } from 'claude-prompt-optimizer-mcp'` → programmatic API (pure, no side effects)
- `import 'claude-prompt-optimizer-mcp/server'` → starts MCP stdio server (side-effect import)
- `npx claude-prompt-optimizer-mcp` → CLI (unchanged, uses `bin/cli.js`)

**Package internals:**
- `bin/cli.js` is the MCP server entry point, importing `dist/src/index.js`
- `bin/lint.js` is the `prompt-lint` CLI entry point, importing `dist/src/lint-cli.js`
- `package.json` has `bin` pointing to both `bin/cli.js` and `bin/lint.js`, `files` whitelist ships only `dist/`, `bin/`, `README.md`, `LICENSE`
- `prepublishOnly` script runs `npm run build` before publish
- `exports["."]` → `dist/src/api.js` (barrel export), `exports["./server"]` → `dist/src/index.js` (MCP server)

## Environment Variables

| Var | Default | Purpose |
|-----|---------|---------|
| `PROMPT_CONTROL_PLANE_PRO` | unset | Set to `true` to enable pro tier (env var override). Tier priority: license key > env var > default free. |
| `PROMPT_CONTROL_PLANE_LOG_LEVEL` | `info` | Log verbosity: debug, info, warn, error |
| `PROMPT_CONTROL_PLANE_LOG_PROMPTS` | unset (false) | Set to `true` to enable raw prompt logging. **Never enable in shared environments.** |

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

- **Phase A (current):** Local file-based storage (`~/.prompt-control-plane/`), env var tier override, instance-scoped rate limiting
- **Phase B (future):** Cloudflare Worker + Supabase + Stripe. Same `StorageInterface`, same tool contracts, only implementation swaps

The async `StorageInterface` and `ExecutionContext` pattern ensure Phase B requires zero tool handler changes. Enforced by `test/contracts.test.ts`.

## 19 MCP Tools

| # | Tool | Free/Metered | Purpose |
|---|------|-------------|---------|
| 1 | `optimize_prompt` | **Metered** | Main entry: analyze → score → compile → estimate cost → return PreviewPack |
| 2 | `refine_prompt` | **Metered** | Iterative: answer questions, add edits → updated PreviewPack |
| 3 | `approve_prompt` | Free | Sign-off gate: returns final compiled prompt + quality_score_before |
| 4 | `estimate_cost` | Free | Multi-provider token + cost estimator (Anthropic, OpenAI, Google, Perplexity) |
| 5 | `compress_context` | Free | Smart compression with H1-H5 heuristics, zone protection, preserve patterns |
| 6 | `check_prompt` | Free | Lightweight pass/fail + score + top 2 issues |
| 7 | `configure_optimizer` | Free | Set mode, threshold, strictness, target, ephemeral mode, session limits, policy_mode, audit_log, session_retention_days |
| 8 | `get_usage` | Free | Usage count, limits, remaining, tier info |
| 9 | `prompt_stats` | Free | Aggregates: total, avg score, top task types, cost savings |
| 10 | `set_license` | Free | Activate Pro license key (Ed25519 offline validation) |
| 11 | `license_status` | Free | Check license status, tier, expiry. Shows purchase link if no license. |
| 12 | `classify_task` | Free | Classify prompt by task type, complexity, risk, and suggested profile |
| 13 | `route_model` | Free | Route to optimal model with full `decision_path` audit trail |
| 14 | `pre_flight` | **Metered** | Full pre-flight pipeline: classify → risk → route → score. 1 use. |
| 15 | `prune_tools` | Free | Score/rank tools by relevance; optionally prune low-relevance to save tokens |
| 16 | `list_sessions` | Free | List all sessions (metadata only, no raw prompts, newest-first) |
| 17 | `export_session` | Free | Full session export with rule-set hash, risk score, policy metadata |
| 18 | `delete_session` | Free | Delete a single session by ID |
| 19 | `purge_sessions` | Free | Safe-by-default session purge with age filters, keep_last, dry_run |

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
| `src/api.ts` | Barrel export for programmatic API — re-exports all pure functions + `optimize()` convenience pipeline |
| `src/tools.ts` | 19 MCP tool registrations with Zod schemas, freemium gate, ExecutionContext, error handling |
| `src/types.ts` | All interfaces: TierLimits, PLAN_LIMITS, PreviewPack, ExecutionContext, StorageInterface, OutputTarget, LicenseData |
| `src/license.ts` | Ed25519 offline license key validation (public key only, zero npm deps) |
| `src/analyzer.ts` | Intent decomposition: raw prompt → IntentSpec. Three-layer task detection. `classifyComplexity()` for 6-type reasoning complexity classification. |
| `src/compiler.ts` | Multi-LLM compilation: IntentSpec → claude/openai/generic output with format_version. Smart compression pipeline (H1-H5 heuristics). |
| `src/estimator.ts` | Multi-provider cost estimation (Anthropic, OpenAI, Google, Perplexity), target-aware recommendations, `TIER_MODELS`, `routeModel()` with 2-step deterministic routing |
| `src/profiles.ts` | 5 frozen optimization profiles (`cost_minimizer`, `balanced`, `quality_first`, `creative`, `enterprise_safe`), `suggestProfile()`, `resolveProfile()` |
| `src/scorer.ts` | Quality scoring (0-100, 5 dimensions × 20 points, scoring_version: 2). `generateChecklist()` for structural coverage. |
| `src/rules.ts` | 14 deterministic ambiguity detection rules with `applies_to` field, `RISK_WEIGHTS`, `computeRiskScore()`, `deriveRiskLevel()` |
| `src/templates.ts` | `Record<TaskType, string>` for roles and workflows |
| `src/session.ts` | Async session management delegating to StorageInterface |
| `src/logger.ts` | Structured logging with levels, request ID correlation, prompt logging gate |
| `src/rateLimit.ts` | `LocalRateLimiter` — instance-scoped, tier-keyed sliding window |
| `src/sort.ts` | Deterministic ordering helpers: CHECKLIST_ORDER, sortCountsDescKeyAsc, sortIssues, sortCostEntries |
| `src/storage/interface.ts` | StorageInterface type, defaults (DEFAULT_CONFIG, DEFAULT_USAGE, DEFAULT_STATS) |
| `src/storage/localFs.ts` | File-based StorageInterface implementation (`~/.prompt-control-plane/`) |
| `src/storage/index.ts` | Re-export — Phase B swaps one line |
| `src/constants.ts` | Frozen configuration values for compression, pruning, and rules. PRUNE_THRESHOLD, LICENSE_SCAN_LINES, ALWAYS_RELEVANT_TOOLS. |
| `src/tokenizer.ts` | Centralized token estimation: `estimatePromptTokens()` (words×1.3), `estimateToolTokens()` (chars/4). |
| `src/zones.ts` | Zone scanner: identifies fenced code, tables, lists, JSON, YAML blocks to protect from heuristics. |
| `src/preservePatterns.ts` | Mark untouchable lines before heuristics run. Regex-based + internal patterns. |
| `src/deltas.ts` | Pre-flight delta calculation for compression and pruning token savings estimates. |
| `src/pruner.ts` | Deterministic tool relevance scorer and pruner. Task-type-aware scoring, mention protection, always-relevant tools. |
| `src/lint-cli.ts` | Standalone CLI linter (`prompt-lint` binary). No MCP dependency — reuses `api.ts` functions directly. |
| `src/sessionHistory.ts` | Session persistence, export with auto-calculated `rule_set_hash`, `rule_set_version`, `risk_score`. |
| `src/customRules.ts` | Read-only custom rules loader from `~/.prompt-control-plane/custom-rules/`. Hash calculation, evaluation, validation. |
| `src/policy.ts` | Pure policy evaluation: `evaluatePolicyViolations`, `checkRiskThreshold`, `buildPolicyEnforcementSummary`, `calculatePolicyHash`. Canonical `STRICTNESS_THRESHOLDS`. |
| `src/auditLog.ts` | AuditLogger class: JSONL append-only, local-only, opt-in. No-throw invariant. Details capped at 10 keys. Never stores prompt content. |
| `docs/index.html` | Landing page — hero, providers strip, how-it-works, 4-tier pricing, install |
| `docs/features.html` | Features sub-page — capabilities, all 19 tools, use cases, comparison, API |
| `docs/models.html` | Supported models page — 4 providers, 11 models, routing, output formats |
| `docs/plans.html` | Pricing plans comparison — 4-tier feature matrix, FAQ, CTA |
| `docs/contact.html` | Enterprise contact form — Formspree integration, thank-you redirect |
| `docs/thank-you.html` | Post-form confirmation — next steps, noindex |
| `docs/how-i-built-this.html` | Blog post — "From Idea to Product in 49 Hours" |
| `docs/shared.css` | Shared design system — dark/light tokens, nav, footer, cards, grids, pricing |
| `docs/shared.js` | Theme toggle (localStorage), mobile nav hamburger |
| `scripts/keygen.mjs` | Ed25519 license key generator — supports pro, power, enterprise tiers |

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
| `test/api.test.ts` | Barrel exports, `optimize()` shape/determinism/context/targets, packaging validation |
| `test/e2e.test.ts` | Full pipeline, license→tier upgrade, gate enforcement, checkout URL wiring, config & stats, classify_task/route_model/pre_flight e2e |
| `test/lint-cli.test.ts` | CLI tests — spawns `node bin/lint.js` as child process, tests all flags, exit codes, JSON output, file/stdin/glob input |
| `test/complexity.test.ts` | Complexity classifier: 6 types × 3+ prompts, confidence, signals contract (sorted, capped, key=value format) |
| `test/routing.test.ts` | TIER_MODELS structure, Perplexity pricing, complexity→tier mapping, budget/latency overrides, target-aware selection, fallback, profiles, RESEARCH_INTENT_RE, confidence formula, savings, decision_path, determinism |
| `test/profiles.test.ts` | 5 frozen profiles, suggestProfile mapping, resolveProfile fallback, profile shape contract |
| `test/risk-score.test.ts` | RISK_WEIGHTS/RISK_ESCALATION_THRESHOLD constants, computeRiskScore with dimensional output, deriveRiskLevel |
| `test/heuristics.test.ts` | H1-H5 heuristic functions: license strip, comment collapse, duplicate collapse, stub collapse, middle truncation |
| `test/g36-invariance.test.ts` | Property-based: compressed_tokens ≤ original_tokens (100-input fuzz) |
| `test/g21-drift.test.ts` | 10 golden fixture prompts with locked risk levels — prevents rule regressions |
| `test/pruner.test.ts` | Tool scoring, ranking, pruning, mention protection, always-relevant tools |
| `test/deltas.test.ts` | Pre-flight delta calculation for compression and pruning |
| `test/rules-v31.test.ts` | 4 new rules: hallucination_risk, agent_underspec, conflicting_constraints, token_budget_mismatch |
| `test/zones.test.ts` | Zone scanner: fenced code, tables, lists, JSON, YAML detection |
| `test/zones-termination.test.ts` | Zone scanner termination guarantees |
| `test/tokenizer.test.ts` | Token estimation determinism and consistency |
| `test/preservePatterns.test.ts` | Preserve pattern marking, invalid regex handling |
| `test/constants.test.ts` | Frozen constants validation, stableStringify determinism |
| `test/compression-overloads.test.ts` | 5 compressContext overload signatures, type detection, backward compatibility |
| `test/sessionHistory.test.ts` | Session persistence, export auto-calculation, CRUD, filtering, edge cases |
| `test/reproducibility.test.ts` | RULES_VERSION format, hash stability, risk score in exports, auto-calculation, API barrel exports |
| `test/auditLog.test.ts` | JSONL append, multiple entries, required fields, ISO 8601 timestamps, no-throw, details capping, privacy |
| `test/sessionLifecycle.test.ts` | deleteSession CRUD, purgeByPolicy (age filter, keep_last, dry_run, storage isolation, sorted IDs) |
| `test/policyEnforcement.test.ts` | evaluatePolicyViolations (advisory/enforce), checkRiskThreshold (>= semantics), policy hash determinism |
| `test/enterpriseWorkflow.test.ts` | Full buyer lifecycle: configure → enforce → block → purge → audit trail verification |

## Key Type Contracts

### TierLimits & PLAN_LIMITS
```typescript
{ lifetime: number, monthly: number, rate_per_minute: number, always_on: boolean }
// free:       { lifetime: 10,       monthly: 10,       rate_per_minute: 5,   always_on: false }
// pro:        { lifetime: Infinity, monthly: 100,      rate_per_minute: 30,  always_on: false }
// power:      { lifetime: Infinity, monthly: Infinity,  rate_per_minute: 60,  always_on: true }
// enterprise: { lifetime: Infinity, monthly: Infinity,  rate_per_minute: 120, always_on: true }
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
- **License key format:** `pcp_<base64url({ payload, signature_hex })>`
- **Payload:** `{ tier, issued_at, expires_at, license_id }` — no PII, no email
- **Tier priority chain:** license key (cryptographically verified) > `PROMPT_CONTROL_PLANE_PRO` env var > default free
- **`getLicense()` re-checks expiry** on every read; marks `valid=false` + `validation_error='expired'` if newly expired
- **`setLicense()` sets chmod 600** on POSIX (best-effort, skip on Windows)
- **Gate responses** include `pro_purchase_url` + `power_purchase_url` + `enterprise_purchase_url` + `next_step` when tier limit is hit (not on rate limits)
- **Infinity serialization guard**: `sanitizeLimits()` converts `Infinity` to `null` in all JSON responses via `SerializedTierLimits` type

## Scoring

- **scoring_version: 2** — max 100/100 achievable (v1 capped at 96)
- 5 dimensions × 20 points: Clarity, Specificity, Completeness, Constraints, Efficiency
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

## npm Publishing

**Just run:** `npm publish --access public` — the automation token in `~/.npmrc` handles auth with no OTP.

**If it fails with EOTP:** The token was overwritten. Tell the user to create a new **Automation** token (NOT Publish, NOT Read-only) at https://www.npmjs.com/settings/tokens, then run: `npm config set //registry.npmjs.org/:_authToken=<new-token>`

**Never ask the user for an OTP code.** Never try env var hacks. The automation token is the solution.

## v3.0 Decision Engine

v3.0 adds a pre-LLM decision layer on top of the existing linter. **Zero LLM calls — still deterministic, offline, reproducible.**

### Routing Architecture
- **`ModelTier = 'small' | 'mid' | 'top'`** — canonical tier used everywhere (G9)
- **2-step routing:** (1) complexity + risk → default tier, (2) budget/latency overrides → final tier
- **`TIER_MODELS`** — frozen constant: 3 tiers × 4 providers (anthropic, openai, google, perplexity)
- **`RESEARCH_INTENT_RE`** — strict word-boundary regex for Perplexity opt-in (G15)
- **`RISK_ESCALATION_THRESHOLD = 40`** — named constant, not a magic number (G11)
- **Perplexity** — recommendation-only, NOT an OutputTarget; uses `generic` compile format

### Key Constants
- `BASELINE_MODEL = 'gpt-4o'` ($2.50/$10.00 per 1M tokens) — savings comparison baseline (G2)
- `RISK_WEIGHTS` — 14 rules × dimensional weights (underspec, hallucination, scope, constraint)
- `PROFILES` — 5 frozen presets: `cost_minimizer`, `balanced`, `quality_first`, `creative`, `enterprise_safe`

### Metering Contract (G6)
- `classify_task` + `route_model` = **FREE** (no metering)
- `pre_flight` = **1 metered use** (same as `optimize_prompt`)
- `pre_flight` does NOT call `optimize_prompt` internally — no double-metering

### Output Versioning
- All v3 tool outputs include `schema_version: 1` for forward-compatible versioning
- Risk score (0–100) drives routing; `riskLevel` is derived for display only (`0-29=low`, `30-59=medium`, `60-100=high`)
- Perplexity is in pricing + routing recommendations only (not an OutputTarget)

## v3.1 Smart Compression + Tool Pruning

v3.1 adds a compression heuristics pipeline and tool pruning engine. **Zero LLM calls — still deterministic, offline, reproducible.**

### Compression Pipeline (H1-H5)
- **H2**: License/header strip (top 40 lines, strong legal token detection)
- **H3**: Comment collapse (5+ consecutive // lines → keep first 2)
- **H1**: Consecutive duplicate collapse (exact match, preserve first)
- **H4**: Stub collapse (comment-only function bodies, gated by config)
- **H5**: Middle truncation (aggressive mode only, respects token budget)

Pipeline order is deterministic: legacy compression → H2 → H3 → H1 → H4 → H5. Each heuristic respects zones and preserved lines.

### Zone Scanner
Protects structured content from heuristic modification: fenced code blocks, markdown tables (≥2 lines), markdown lists (≥3 lines), JSON blocks, YAML frontmatter.

### Preserve Patterns
User-supplied regex patterns (strings) mark lines as untouchable before the pipeline runs. Internal patterns also protect dedup placeholders from re-compression.

### Tool Pruner
- `scoreAllTools()` — task-type-aware relevance scoring (0-100)
- `rankTools()` — sorted by relevance (highest first)
- `pruneTools()` — marks bottom-M as prunable, respects mention protection + always-relevant set
- `ALWAYS_RELEVANT_TOOLS` = {search, read, write, edit, bash} — never pruned
- `TASK_REQUIRED_TOOLS` — high-confidence matches per task type

### Pre-Flight Deltas
Estimated token savings shown before user commits to optimization. Conditional presence (only when savings > 0).

### New Rules (10 → 14)
- `hallucination_risk` — ungrounded factual claims without source context
- `agent_underspec` — autonomous execution without safety constraints
- `conflicting_constraints` — contradictory must/must-not pairs
- `token_budget_mismatch` — small model + large output scope

### G21 Drift Guardrail
10 golden fixture prompts with locked risk levels. Prevents rule regressions during development.

### G36 Invariant
Property-based test: `compressed_tokens ≤ original_tokens` for 100 random inputs.

## v3.2 Enterprise Unlock + Docs Site

v3.2 adds the Enterprise tier and a multi-page documentation site. **No behavioral core changes.**

### Enterprise Tier
- `Tier` type now includes `'enterprise'`
- `PLAN_LIMITS.enterprise`: `{ lifetime: Infinity, monthly: Infinity, rate_per_minute: 120, always_on: true }`
- `keygen.mjs` and `license.ts` updated to support enterprise key generation/validation
- Gate responses include `enterprise_purchase_url` alongside pro/power URLs
- `SerializedTierLimits` type — converts `Infinity` → `null` for JSON-safe serialization
- `sanitizeLimits()` helper in `tools.ts` and `storage/localFs.ts`

### Multi-Page Docs Site
Monolithic `index.html` (1094 lines, 11 sections) split into focused pages:
- `index.html` — Hero, providers strip, how-it-works, 4-tier pricing, install
- `features.html` — Core capabilities, all 19 tools, use cases, comparison, API
- `models.html` — 4 providers × 11 models, routing, output formats
- `contact.html` — Enterprise contact form (Formspree)
- `thank-you.html` — Post-form confirmation

### Shared Design System
- `shared.css` — Dark/light theme tokens, nav, footer, cards, grids, pricing, tags
- `shared.js` — Theme toggle with `localStorage` persistence, mobile hamburger
- `[data-theme="light"]` override pattern — user preference respected via `prefers-color-scheme`
- All pages use consistent nav with: Home | Features | Models | Docs | Plans | Blog + theme toggle

## v3.3 Enterprise Operations & Control

v3.3 adds operational completeness for enterprise buyers — the governance layer a CTO needs before approving AI in production. **Zero LLM calls — still deterministic, offline, reproducible.**

### Policy Enforcement
- `policy_mode: 'advisory' | 'enforce'` — config-driven, default advisory
- `enforce` mode gates: `optimize_prompt` blocked on BLOCKING violations, `approve_prompt` blocked on violations OR risk threshold
- **BLOCKING scope**: Both built-in AND custom BLOCKING rules enforced (not just custom)
- Risk threshold: `score >= threshold` → blocked (relaxed=40, standard=60, strict=75)
- `STRICTNESS_THRESHOLDS` canonical source in `src/policy.ts`
- Error payloads: `policy_violation` (with violations[]), `risk_threshold_exceeded` (with score, threshold, strictness)
- `policy_hash` in approve_prompt success + export_session metadata

### Config Lock Mode
- `locked_config: true` + `lock_secret_hash` — passphrase-protected config locking
- Lock: `configure_optimizer(lock=true, lock_secret='passphrase')` — stores SHA-256 hash, never the secret
- Unlock: `configure_optimizer(unlock=true, lock_secret='passphrase')` — must match original
- Wrong secret → `invalid_lock_secret` error + audit-logged
- Any config change while locked → `config_locked` error + audit-logged
- Provides "who can change governance" control without RBAC infrastructure

### Tamper-Evident Audit Trail
- `audit_log: true` — opt-in, local-only, JSONL append to `~/.prompt-control-plane/audit.log`
- **Hash chaining**: Each entry includes `integrity_hash = SHA-256(prev_hash + JSON(entry))`. First entry chains from `GENESIS_HASH` (64 zeros).
- If any line is deleted or modified, all subsequent hashes break → tamper detected
- `auditLogger.verifyChain()` — verify integrity programmatically
- Events: optimize, approve, delete, purge, configure, license_activate
- Outcomes: success, blocked, error
- **Privacy invariant**: Never stores `raw_prompt` or `compiled_prompt`. Details capped at 10 keys.
- No-throw: audit write failures never break the pipeline

### Session Lifecycle
- `delete_session` (Tool 18): Delete single session by ID
- `purge_sessions` (Tool 19): Safe-by-default purge with `older_than_days`, `keep_last`, `purge_all`, `dry_run`
- `session_retention_days` config: Default age policy for purge
- Storage isolation: Purge only deletes `session-*.json` — never touches audit.log, config.json, usage.json, license.json, custom-rules.json
- `deleted_session_ids` always sorted lexicographic, capped at 100

### Key Constants
- `STRICTNESS_THRESHOLDS` = `{ relaxed: 40, standard: 60, strict: 75 }` — in `src/policy.ts`
- `GENESIS_HASH` = 64 zeros — well-known first hash in audit chain
- Tool count: 17 → 19 (v3.1=15 → v3.2.1=17 → v3.3.0=19)

## Breaking Changes (v1 → v2)

- `quality_after` → `compilation_checklist` (CompilationChecklist, not a numeric score)
- `PreviewPack` now includes `request_id`, `target`, `format_version: 1`, `scoring_version: 2`, `storage_health?`
- All responses include `request_id` (success and error)
- `CostEstimate.costs` now includes OpenAI + Google models (was Anthropic-only)
- `compilePrompt()` takes `target: OutputTarget` parameter
- 4 new tools: `check_prompt`, `configure_optimizer`, `get_usage`, `prompt_stats`
- Sessions backed by async StorageInterface (was sync in-memory Map)
- Scoring max changed from 96 to 100 (scoring_version: 2)
