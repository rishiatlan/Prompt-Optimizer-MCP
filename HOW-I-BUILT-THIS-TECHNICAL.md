# Building a Prompt Optimizer MCP: Architecture, Decisions, and Distribution

**A technical deep-dive into building, monetizing, and distributing a Model Context Protocol server from zero to production.**

By Rishi Banerjee

---

## Table of Contents

- [Problem Statement](#problem-statement)
- [Architecture Overview](#architecture-overview)
- [The Deterministic Pipeline](#the-deterministic-pipeline)
- [Type System and Contracts](#type-system-and-contracts)
- [Freemium Engine: Gates, Metering, and Rate Limiting](#freemium-engine)
- [Ed25519 Offline License System](#ed25519-offline-license-system)
- [Multi-LLM Compilation](#multi-llm-compilation)
- [Storage Abstraction: Phase A/B Split](#storage-abstraction)
- [Testing Strategy: 129 Tests, Zero Mocks](#testing-strategy)
- [Programmatic API: Dual Entry Points](#programmatic-api)
- [Distribution Pipeline](#distribution-pipeline)
- [Build Invariants](#build-invariants)
- [What Went Wrong](#what-went-wrong)
- [Stack and Dependencies](#stack-and-dependencies)
- [What I'd Do Differently](#what-id-do-differently)

---

## Problem Statement

LLM prompts fail predictably. "Make the code better" gives Claude no constraints, no success criteria, and no target. The result: hallucinated scope, wasted tokens, and 3-4 rounds of clarification.

The insight: **prompt quality is a deterministic, measurable property.** You don't need AI to detect that a prompt is missing a role definition, has no constraints, or contains multiple unrelated tasks. A rules engine can score, restructure, and compile prompts — zero LLM calls, zero latency, zero cost.

MCP (Model Context Protocol) is the ideal delivery mechanism: it sits inside the AI conversation, intercepts prompts before execution, and returns structured output that the host Claude can present as a review step.

> **TL;DR:** Prompt quality is measurable. MCP is the delivery channel. The optimizer is a deterministic compiler, not another AI wrapper.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                     Host Claude                      │
│                                                      │
│  User: "fix the login bug"                          │
│         │                                            │
│         ▼                                            │
│  Claude calls optimize_prompt tool via MCP           │
│         │                                            │
│         ▼                                            │
│  ┌──────────────────────────────────────────┐       │
│  │        Prompt Optimizer MCP Server        │       │
│  │                                           │       │
│  │  ┌─────────┐  ┌────────┐  ┌──────────┐  │       │
│  │  │Analyzer │→ │Scorer  │→ │Compiler  │  │       │
│  │  │         │  │        │  │          │  │       │
│  │  │Intent   │  │5-dim   │  │XML/OAI/  │  │       │
│  │  │decomp   │  │×20pts  │  │Markdown  │  │       │
│  │  └─────────┘  └────────┘  └──────────┘  │       │
│  │       │            │            │         │       │
│  │       ▼            ▼            ▼         │       │
│  │  ┌──────────┐  ┌──────────────────────┐  │       │
│  │  │Checklist │  │Cost Estimator        │  │       │
│  │  │9-item    │  │8 models × 3 providers│  │       │
│  │  └──────────┘  └──────────────────────┘  │       │
│  │                                           │       │
│  │  ┌──────────────────────────────────────┐│       │
│  │  │ Freemium Gate │ Storage │ Rate Limit ││       │
│  │  └──────────────────────────────────────┘│       │
│  └──────────────────────────────────────────┘       │
│         │                                            │
│         ▼                                            │
│  Claude presents PreviewPack to user                 │
│  User approves → Claude uses compiled prompt         │
└─────────────────────────────────────────────────────┘
```

Key architectural decisions:

1. **Pure functions throughout.** Every pipeline stage is a pure function: `(input) → output`. No side effects, no I/O, no globals. This makes every function independently testable and composable.

2. **`ExecutionContext` pattern.** Every tool handler receives `{ requestId, storage, logger, config, rateLimiter, tier }`. This is the Phase B migration bridge — in Phase B, `tier` comes from API key auth instead of local storage, but tool handlers don't change.

3. **StorageInterface abstraction.** All file I/O goes through an async interface. Phase A: local filesystem (`~/.prompt-optimizer/`). Phase B: Cloudflare Workers KV or Supabase. Same interface, different implementation.

---

## The Deterministic Pipeline

### Stage 1: Analyzer (`src/analyzer.ts`)

Decomposes raw prompts into `IntentSpec` using three-layer task detection:

```typescript
// Layer 1: Intent-first (output type keywords)
// "Write a post about my MCP" → writing (not code)
// "Create a REST API" → create (not writing)

// Layer 2: Full-prompt pattern matching
// "refactor", "debug", "fix" → code tasks
// "blog", "email", "tweet" → writing tasks

// Layer 3: Fallback heuristics
// Default to "other" with generic scoring
```

The intent-first layer is critical. Without it, "Write a post about my MCP" classifies as code because "MCP" sounds technical. The analyzer looks for output-format signals (`post`, `article`, `tweet`) before content signals.

**Output:** `IntentSpec` containing task type, risk level, detected inputs/outputs, blocking questions, assumptions, and definition of done.

### Stage 2: Scorer (`src/scorer.ts`)

Scores 0-100 across 5 dimensions (20 points each):

| Dimension | Measures | Deductions |
|-----------|----------|------------|
| **Clarity** | Goal specificity, unambiguous language | -4 per vague term ("make it better", "fix it", "somehow") |
| **Specificity** | Named files, concrete values, measurable criteria | -6 if no specific targets |
| **Completeness** | Role, inputs, outputs, success criteria | -4 per missing element |
| **Constraints** | Explicit do/don't rules, preservation instructions | +2 bonus for "keep existing", "maintain" |
| **Efficiency** | Conciseness, no repetition, right-sized | +2 bonus for <1000 tokens + no repetition |

`scoring_version: 2` — max 100/100 achievable (v1 capped at 96 due to missing bonus categories).

`generateChecklist()` is a separate function that checks 9 structural elements (Role, Goal, Constraints, Inputs, Outputs, Success Criteria, Workflow, Uncertainty Policy, Domain Context) of the **compiled** output — not the raw prompt. This distinction matters: the score measures the raw prompt's quality, the checklist measures the compiled output's completeness.

### Stage 3: Compiler (`src/compiler.ts`)

Compiles `IntentSpec` into structured output for three targets:

```xml
<!-- Claude target -->
<role>Senior backend engineer specializing in authentication systems</role>
<goal>Fix the login bug causing session timeouts after OAuth callback</goal>
<constraints>
  - Do not modify the user model or database schema
  - Preserve existing session management behavior
  - All changes must pass existing auth.test.ts
</constraints>
<workflow>
  1. Read src/auth/middleware.ts and identify the session timeout logic
  2. Trace the OAuth callback flow from routes/auth.ts
  3. Implement the fix with minimal changes
  4. Run auth.test.ts and verify all tests pass
</workflow>
```

```
# OpenAI target
[SYSTEM]
You are a senior backend engineer specializing in authentication systems.
[USER]
## Goal
Fix the login bug causing session timeouts after OAuth callback...
```

```markdown
# Generic target (Markdown)
## Role
Senior backend engineer specializing in authentication systems

## Goal
Fix the login bug causing session timeouts after OAuth callback...
```

Platform-specific hints adjust for Slack (short paragraphs, emoji-friendly), LinkedIn (professional tone), and email (subject line + body structure).

### Stage 4: Checklist (`src/scorer.ts → generateChecklist()`)

9-item structural coverage check applied to the compiled output:

```typescript
const CHECKLIST_ORDER = [
  'Role', 'Goal', 'Constraints', 'Inputs',
  'Outputs', 'Success Criteria', 'Workflow',
  'Uncertainty Policy', 'Domain Context'
];
```

Each item: `{ present: boolean, strength: 'strong' | 'weak' | 'absent' }`.

### Stage 5: Cost Estimator (`src/estimator.ts`)

Token estimation + per-provider pricing across 8 models:

```typescript
// Pricing data (versioned: 2026-02)
const PRICING_DATA = {
  'claude-3.5-haiku':  { input: 0.80,  output: 4.00 },
  'claude-sonnet-4':   { input: 3.00,  output: 15.00 },
  'claude-opus-4':     { input: 15.00, output: 75.00 },
  'gpt-4o-mini':       { input: 0.15,  output: 0.60 },
  'gpt-4o':            { input: 2.50,  output: 10.00 },
  'o1':                { input: 15.00, output: 60.00 },
  'gemini-2.0-flash':  { input: 0.10,  output: 0.40 },
  'gemini-2.0-pro':    { input: 1.25,  output: 5.00 },
};
// All prices per 1M tokens
```

Returns: estimated tokens, cost per model, cheapest option, recommended model based on task complexity and risk level.

> **TL;DR:** Five pure-function stages. Analyzer → Scorer → Compiler → Checklist → Estimator. Each stage's output is the next stage's input. All deterministic, all testable, all composable.

---

## Type System and Contracts

### PreviewPack (the main response envelope)

```typescript
interface PreviewPack {
  request_id: string;           // UUID v4
  quality_before: QualityScore; // Raw prompt score
  compiled_prompt: string;      // Structured output
  compilation_checklist: CompilationChecklist;
  cost_estimate: CostEstimate;
  blocking_questions: string[]; // Must answer before proceeding
  assumptions: string[];        // Surfaced for review
  changes_made: string[];       // What the compiler added
  task_type: TaskType;
  risk_level: RiskLevel;
  model_recommendation: string;
  target: OutputTarget;
  format_version: 1;
  scoring_version: 2;
  storage_health?: 'healthy' | 'degraded';
}
```

### Immutable via contract tests

`test/contracts.test.ts` freezes the shape of every response type. If a field is added, removed, or renamed, the test fails. This prevents accidental breaking changes to the API surface.

---

## Freemium Engine

### Three Tiers

```typescript
const PLAN_LIMITS: Record<Tier, TierLimits> = {
  free:  { lifetime: 10,       monthly: 10,       rate_per_minute: 5,  always_on: false },
  pro:   { lifetime: Infinity, monthly: 100,      rate_per_minute: 30, always_on: false },
  power: { lifetime: Infinity, monthly: Infinity,  rate_per_minute: 60, always_on: true },
};
```

### Gate Enforcement

`canUseOptimization(ctx)` checks three gates in order:

1. **Lifetime** — free tier: 10 total optimizations ever
2. **Monthly** — pro tier: 100 per calendar month (resets on the 1st)
3. **Rate** — per-minute sliding window (5/30/60 depending on tier)

**Critical invariant: metering-after-success.** Usage is only incremented after the pipeline completes without errors:

```typescript
let success = false;
try {
  // ... full pipeline execution ...
  success = true;
} finally {
  if (success) await storage.incrementUsage();
}
```

This prevents charging users for failed requests. Enforced by `test/e2e.test.ts`.

### Rate Limiter (`src/rateLimit.ts`)

Instance-scoped sliding window, tier-keyed:

```typescript
class LocalRateLimiter {
  // Separate timestamp arrays per tier
  // Counts entries within 60-second window
  // Returns { allowed, retry_after_seconds }
}
```

No global state. No singletons. Each MCP server instance gets its own rate limiter. This is correct for Phase A (local) and Phase B (per-worker isolation).

---

## Ed25519 Offline License System

### Why Ed25519?

- **Asymmetric:** Public key verifies, private key signs. Public key is safe to embed in open-source code.
- **No network required:** Validation is a single `crypto.verify()` call. Works on planes, behind VPNs, in air-gapped environments.
- **No external dependencies:** Node.js `crypto` module handles everything.
- **Compact:** Ed25519 signatures are 64 bytes. Entire license key fits in a single string.

### Key Format

```
po_pro_eyJ0aWVyIjoicHJvIiwiaXNzdWVkX2F0IjoiMjAyNi0wMi0yOCIsImV4cGlyZXNfYXQiOiIyMDI2LTAzLTI4IiwibGljZW5zZV9pZCI6IjU1NTU1NTU1LTU1NTUtNTU1NS01NTU1LTU1NTU1NTU1NTU1NSJ9.abcdef0123456789...
```

Structure: `po_{tier}_{base64url({ payload_json, signature_hex })}`

### Payload

```typescript
interface LicensePayload {
  tier: 'pro' | 'power';
  issued_at: string;    // ISO 8601
  expires_at: string;   // ISO 8601
  license_id: string;   // UUID (no PII — no email, no name)
}
```

### Validation Flow

```typescript
function validateLicenseKey(key: string): LicenseData {
  // 1. Strip prefix (po_pro_ or po_power_)
  // 2. Base64url decode → { payload_json, signature_hex }
  // 3. Canonicalize payload (sorted keys, no whitespace)
  // 4. crypto.verify('ed25519', canonical, publicKey, signature)
  // 5. Check expiry (expires_at > now)
  // 6. Return LicenseData with valid=true/false
}
```

**Tier priority chain:** License key (cryptographically verified) > `PROMPT_OPTIMIZER_PRO` env var > default free.

### Key Management

- **Private key:** `scripts/.private-key.pem` (gitignored, backed up separately)
- **Public key:** `PRODUCTION_PUBLIC_KEY_PEM` constant in `src/license.ts`
- **Key generation:** `node scripts/keygen.mjs init` — one-time operation
- **License generation:** `node scripts/keygen.mjs generate pro 30` — generates a pro key valid for 30 days

⚠️ **Regenerating the keypair invalidates ALL existing licenses.** This is a one-way door.

---

## Multi-LLM Compilation

The compiler produces three output formats from a single `IntentSpec`:

| Target | Format | Markers | Use Case |
|--------|--------|---------|----------|
| `claude` | XML tags | `<role>`, `<goal>`, `<constraints>` | Claude Code, Claude Desktop |
| `openai` | System/User split | `[SYSTEM]`, `[USER]`, `## Headers` | GPT-4, o1, via API |
| `generic` | Markdown | `## Role`, `## Goal`, `## Constraints` | Any LLM, documentation |

Configuration is persistent via `configure_optimizer` tool: set `target: 'openai'` once, and all subsequent compilations use the OpenAI format.

---

## Storage Abstraction

### The Interface

```typescript
interface StorageInterface {
  // Sessions
  createSession(id: string, data: SessionData): Promise<void>;
  getSession(id: string): Promise<SessionData | null>;
  deleteSession(id: string): Promise<void>;
  cleanupSessions(): Promise<number>;

  // Usage & Stats
  getUsage(): Promise<UsageData>;
  incrementUsage(): Promise<void>;
  getStats(): Promise<StatsData>;
  updateStats(fn: (s: StatsData) => StatsData): Promise<void>;

  // License
  getLicense(): Promise<LicenseData | null>;
  setLicense(data: LicenseData): Promise<void>;

  // Config
  getConfig(): Promise<ConfigData>;
  setConfig(data: ConfigData): Promise<void>;

  // Health
  canUseOptimization(ctx: ExecutionContext): Promise<EnforcementResult>;
}
```

### Phase A: Local Filesystem

`LocalFsStorage` implements this interface using `~/.prompt-optimizer/`:

```
~/.prompt-optimizer/
├── config.json
├── usage.json
├── stats.json
├── license.json
└── sessions/
    ├── {session-id}.json
    └── ...
```

**No-throw invariant:** Every public method catches all errors and returns safe defaults. If the disk is full, the optimizer degrades gracefully (reports `storage_health: 'degraded'`) instead of crashing.

### Phase B: Cloud (planned)

Same interface, different implementation:
- `CloudflareKVStorage` or `SupabaseStorage`
- `ExecutionContext` gains `user_id`, `api_key_hash`, `workspace_id`
- Rate limiting moves from instance-scoped to distributed
- **Zero tool handler changes.** Only `storage/index.ts` export swaps.

---

## Testing Strategy

### 129 tests, 9 files, zero mocks

| File | Focus | Count |
|------|-------|-------|
| `scorer.test.ts` | 100/100 ceiling, dimension boundaries, preservation bonus | ~20 |
| `compiler.test.ts` | XML/OpenAI/generic output, format_version, blocking Q exclusion | ~15 |
| `storage.test.ts` | CRUD, session lifecycle, path traversal, cleanup | ~20 |
| `freemium.test.ts` | Lifetime gate, pro bypass, metering-after-success, rate limiter | ~15 |
| `contracts.test.ts` | Output shape freeze (PreviewPack, CostEstimate, LicenseData) | ~10 |
| `security.test.ts` | Input hardening, session ID sanitization, no-throw invariant | ~10 |
| `license.test.ts` | Ed25519 validation, storage CRUD, tier priority chain, file permissions | ~15 |
| `api.test.ts` | Barrel exports, `optimize()` shape/determinism/targets, packaging | ~9 |
| `e2e.test.ts` | Full pipeline, license→tier upgrade, gate enforcement, checkout URLs | ~15 |

**Key testing patterns:**

1. **Ed25519 test keypair per suite.** Tests generate their own keypair via `crypto.generateKeyPairSync('ed25519')` — never use the production key.
2. **Temp directories.** Every test suite creates a temp dir, runs against it, cleans up in `afterEach`.
3. **Contract tests.** `contracts.test.ts` verifies exact field sets of response types. Adding a field without updating contracts = test failure.
4. **Packaging validation.** `api.test.ts` verifies that `dist/src/api.js` and `dist/src/index.js` actually exist at the paths referenced in `package.json` exports.
5. **Metering-after-success.** `e2e.test.ts` verifies that if the pipeline throws mid-execution, the usage counter is NOT incremented.

All tests use `node:test` (built-in, zero test framework dependency). Run with `npm test`.

---

## Programmatic API

### Dual Entry Points (ESM-only)

```typescript
// Entry 1: Programmatic API (pure functions, no side effects)
import { optimize, scorePrompt, compilePrompt } from 'claude-prompt-optimizer-mcp';

const result = optimize('fix the login bug', 'auth middleware context');
// Returns: { intent, score, compiled, checklist, costEstimate }

// Entry 2: MCP Server (side-effect import — starts stdio transport)
import 'claude-prompt-optimizer-mcp/server';
// Server is now running on stdio

// Entry 3: CLI
// npx claude-prompt-optimizer-mcp
```

`package.json` exports map:

```json
{
  "exports": {
    ".": { "types": "./dist/src/api.d.ts", "import": "./dist/src/api.js" },
    "./server": { "types": "./dist/src/index.d.ts", "import": "./dist/src/index.js" }
  }
}
```

**ESM-only.** No CJS wrapper. `"type": "module"` in package.json. All imports use `.js` extensions. CJS consumers get a clear error. This is a deliberate choice — CJS compatibility adds complexity with zero benefit for the MCP ecosystem.

---

## Distribution Pipeline

### Channels

| Channel | Submission Method | Status |
|---------|-------------------|--------|
| **npm** | `npm publish --access public` | ✅ v2.2.2 |
| **Official MCP Registry** | `mcp-publisher publish` CLI + GitHub device auth | ✅ Listed |
| **Glama** | Web form: name + description + GitHub URL | ✅ Submitted |
| **mcp.so** | GitHub issue on chatmcp/mcpso repo | ✅ Submitted |
| **PulseMCP** | Auto-ingests from Official Registry daily | ✅ Automatic |
| **awesome-mcp-servers** | Fork → branch → edit README → PR | ✅ PR #2492 |
| **Smithery** | CLI (`@smithery/cli mcp publish`) | ❌ Blocked — ESM incompatibility |
| **GitHub** | Public repo + GitHub Pages landing page | ✅ Live |

### Smithery Incompatibility (technical detail)

Smithery's `@smithery/cli` uses esbuild with `format: "cjs"` for both the shttp (HTTP gateway) and stdio (scanning) builds. Our server uses ESM-only features:

```typescript
// These cause esbuild CJS errors:
import.meta.url          // "import.meta" not available in CJS
await storage.cleanup(); // Top-level await not supported in CJS
await server.connect();  // Top-level await not supported in CJS
```

The shttp bundle builds successfully (it wraps in an async handler), but the stdio scan step fails. No configuration option to change esbuild's output format. This is a Smithery tooling limitation that affects any ESM-only MCP server using top-level await.

### MCP Registry Publication Flow

```bash
# 1. Add mcpName to package.json
"mcpName": "io.github.rishiatlan/claude-prompt-optimizer"

# 2. Create server.json metadata file
# 3. Publish to npm (mcpName must be in published package)
npm publish --access public

# 4. Install publisher CLI
npm install -g @anthropic-ai/mcp-publisher

# 5. Authenticate via GitHub device code flow
mcp-publisher login

# 6. Publish to registry
mcp-publisher publish
```

Gotcha: The registry validates that `mcpName` exists in the *published* npm package, not just locally. This means you must publish to npm *before* publishing to the registry.

---

## Build Invariants

These are immutable rules enforced by tests. If implementation drifts from any, it's a bug.

| ID | Rule | Enforcement |
|----|------|-------------|
| I1 | **Deterministic ordering** | `src/sort.ts` — all array fields sorted consistently (checklist items, cost entries, issue lists) |
| I2 | **One response envelope** | ALL responses include `request_id` (success AND error) |
| I3 | **Metering-after-success** | `success = true` after pipeline completion; `if (success) increment` in finally |
| I4 | **Rate limit centralized** | Only inside `canUseOptimization(ctx)` — never duplicated in tool handlers |
| I5 | **Degraded health explicit** | `"storage_health": "degraded"` in metered responses when storage unhealthy |

---

## What Went Wrong

### 1. npm Token Type Confusion

npm has three token types: Publish (requires OTP with 2FA), Read-only, and Automation (no OTP). The Automation token is the only one that works in non-interactive environments (CI/CD, scripts, Claude Code sessions). I burned 3 sessions fighting EOTP errors before documenting this permanently.

**Fix:** Documented in project CLAUDE.md — "Never ask for OTP. Just use the Automation token in `~/.npmrc`."

### 2. Ed25519 Key Rotation During Development

Regenerated the keypair mid-development. All pre-generated test licenses became invalid because the public key changed. This is by design — Ed25519 keypairs are tightly coupled — but it caught me off guard.

**Fix:** Documented in `KEYGEN-PROMPT-OPTIMIZER-MCP.md` with explicit warnings about the one-way door nature of key regeneration.

### 3. MCP Registry mcpName Chicken-and-Egg

The registry validates `mcpName` against the *published* npm package. But you only discover this after the publish attempt fails. Required an extra version bump (v2.2.0 → v2.2.2) just to add metadata.

**Fix:** Read the entire registry docs before starting. Version bumps are cheap.

### 4. Smithery ESM Incompatibility

Smithery's CLI bundles everything as CJS via esbuild. Top-level await and `import.meta` are ESM-only features that physically cannot exist in CJS output. No workaround exists on the server side — Smithery would need to add ESM output format support.

**Fix:** None. Documented as a known limitation. Will retry when Smithery updates their tooling.

---

## Stack and Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.25.2",  // MCP protocol
    "zod": "^3.25.0"                          // Schema validation
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.8.0"
  }
}
```

**Two runtime dependencies.** Everything else (crypto, file I/O, path handling, test runner) comes from Node.js built-ins.

| Technology | Purpose |
|------------|---------|
| TypeScript 5.8 (strict mode) | Type safety for a rules engine |
| MCP SDK | Protocol implementation (stdio transport) |
| Zod | Runtime schema validation for tool inputs |
| Node.js crypto | Ed25519 key generation and verification |
| Node.js `node:test` | Built-in test runner (no Jest, no Mocha) |
| esbuild (dev) | Used by Smithery CLI (not in our build) |
| Lemon Squeezy | Payment processing ($0 upfront) |
| GitHub Pages | Landing page hosting ($0) |

**Monthly infrastructure cost: $0.**

---

## What I'd Do Differently

1. **Start with `mcpName` in package.json from v1.0.** The registry requirement caused an unnecessary version bump.

2. **Wrap top-level await in an async IIFE from the start.** Would have avoided the Smithery incompatibility entirely, with zero functional downside.

3. **Add a `smithery.yaml` build config early.** Even if not publishing to Smithery, having the config ready prevents last-minute scrambling.

4. **Generate the landing page from the README.** Currently they're maintained separately. A build step that converts README → HTML would prevent drift.

5. **Add OpenTelemetry tracing from day 1.** Not for the free tier, but for Phase B — having trace IDs flow through the pipeline would make debugging production issues trivial.

---

*Built with Claude Code. 129 tests. 2 dependencies. 11 tools. 0 AI calls. 0 monthly cost. Shipped in 2 weeks.*
