# Learnings — Prompt Optimizer MCP

Everything we learned building a production MCP server in 49 hours with Claude Code. 60 learnings across 10 categories — all reusable across projects.

---

## Architecture

### 1. Deterministic Rules Engine Over AI Calls
Build the optimizer with zero LLM calls — all intelligence comes from the host Claude via regex, heuristics, and template compilation. This gives instant execution (no latency), zero operational cost, deterministic output, and makes hallucinated advice impossible. The host provides intelligence; the MCP provides structure.

### 2. Phase A / Phase B Storage Pattern
Design with an abstract `StorageInterface` from day one. Phase A uses local file storage (`~/.prompt-optimizer/`); Phase B swaps in Cloudflare Workers + Supabase by changing one line in `src/storage/index.ts`. All tool handlers, tests, and types stay identical. Validated via `test/contracts.test.ts`.

### 3. Async Storage Interface as Hard Contract
Define `StorageInterface` as async-first — even the local implementation. Cloud migration (Phase B) naturally needs async I/O; designing for it from the start means no refactoring later. Local file storage uses `fs.promises`, so there's no speed regression.

### 4. Immutable Build-Mode Invariants
Document hard rules that cannot be violated: deterministic ordering, one response envelope, metering-after-success, centralized rate limiting, degraded health signals. Enforce these via contract tests, not convention. The "metering-after-success" invariant is critical: if a tool throws before success, usage count doesn't increment — you never get charged for failures.

### 5. Intent-First Task Detection
Classify prompts by the opening verb phrase first ("Write me a...", "Fix the..."), not by body keywords. Only fall back to keyword matching if the verb is ambiguous. This prevents misclassification: "Write a post about my MCP server" is writing, not code, even though "MCP server" appears.

### 6. Multi-Output Target Compilation
Compile the same prompt to three formats: Claude (XML tags), OpenAI (system/user split), Generic (Markdown headers). One `compilePrompt()` function, parameterized by `target: OutputTarget`. This makes the tool useful across the LLM ecosystem, not just Claude.

### 7. Task-Type-Specific Role Templates
`src/templates.ts` contains a `Record<TaskType, string>` of role definitions for each of the 13 task types. New task types only require adding one template entry + updating analyzer rules.

### 8. Deterministic Ordering Utilities
All array fields in responses are sorted consistently via `src/sort.ts`. Checklists by CHECKLIST_ORDER, cost entries by model name, issue counts descending. This makes tests deterministic and diffs cleaner.

---

## API Design

### 9. Mandatory Human-in-the-Loop Approval Gate
Three-step flow: `optimize_prompt` → `refine_prompt` → `approve_prompt`. The last tool hard-fails if blocking questions remain unanswered — the gate is enforced in code at `tools.ts:396-402`, not by convention. This is a product differentiator: Claude normally starts working immediately on vague input; this MCP forces a review loop.

### 10. Blocking Questions as Enforcement, Not Suggestions
The MCP surfaces up to 3 blocking questions for vague prompts. These are stored in session state and must be answered via `refine_prompt` before `approve_prompt` succeeds. "Fix the bug" without specifying which file blocks until clarified.

### 11. Dual Entry Points (MCP Server + Programmatic API)
Ship two interfaces from one package: MCP server (stdio transport for Claude) and programmatic API (`import { optimize } from 'claude-prompt-optimizer-mcp'`). The `optimize()` function wraps the full pipeline and returns a `PreviewPack`.

### 12. All Responses Include Request ID
Every tool response (success or error) includes a `request_id` for correlation. Generated at the tool invocation layer and threaded through all async operations. Critical for debugging distributed issues in Phase B.

### 13. Freemium Gate at the Tool Level
Metered tools validate tier and enforce limits before any work happens. Rate limiter centralized in `canUseOptimization()`. Usage incremented in a `finally` block (metering-after-success). Prevents leakage from scattered rate-limit checks.

---

## Monetization

### 14. Free Tier as a Funnel, Not a Prison
10 lifetime optimizations — enough to see value, not enough for production use. Local file metering is intentionally "hackable" for technical users. The real paywall is the cryptographic license system. If someone deletes the tracking file, that's fine — the license system handles actual enforcement.

### 15. Ed25519 Offline License Validation
License keys are cryptographically signed with Ed25519. Verification uses only the public key embedded in code. No server, no internet, no telemetry. Works on planes, behind corporate VPNs, and for users who are philosophically opposed to phone-home.

### 16. License Keys Without PII
Keys contain: tier, issued_at, expires_at, license_id. No email, no name, no user ID. Format: `po_pro_<base64url(payload + signature_hex)>`. Privacy-first — no user database, no account recovery needed.

### 17. Tier Priority Chain: License > Env Var > Default
Valid license key → that tier. No license → check `PROMPT_OPTIMIZER_PRO` env var. No env var → free. Allows local testing without needing a real license key.

### 18. Lemon Squeezy for Zero-Cost Payment Infrastructure
Handles subscriptions, tax compliance, and checkout. Zero upfront fees — percentage only on successful sales. No financial risk to launch. Checkout generates license keys that users activate in Claude.

### 19. Calendar-Month Usage Reset
Pro tier gets 100/month resetting on calendar boundaries (Jan 1 → Jan 31), not rolling 30-day windows. Users can reason about quota predictably. Storage tracks `monthly_reset_date`.

---

## Distribution

### 20. Launch on 6+ Directories Simultaneously
Official MCP Registry, Glama, mcp.so, PulseMCP, awesome-mcp-servers, GitHub. Each has different submission processes. awesome-mcp-servers is most prestigious (curated); Glama is widest (17K+ servers); official registry is most authoritative.

### 21. Four Install Methods for Different Users
(1) Paste JSON into config (novices), (2) `npx -y` (one-off), (3) `npm install -g` (power users), (4) `curl | bash` (developers). Lowers the barrier at every skill level.

### 22. Landing Page on GitHub Pages (Free Hosting)
Dark-themed single HTML page, no framework. Loads in under 1 second. Includes before/after demo, pricing, install instructions, security info. Zero hosting cost.

### 23. Interactive Before/After Demo
Show a vague prompt scoring 38/100 transforming into structured XML scoring 91/100. The +53 point improvement instantly communicates value.

### 24. npm Metadata for Discoverability
Include keywords, description, `mcpName`, homepage, repository, and bugs URL. Each registry indexes different fields — Official MCP Registry requires `mcpName`; Glama uses keywords.

### 25. Not All Directories Support ESM
Smithery forces CJS. The optimizer uses ESM with top-level `await` — incompatible. Document the limitation and ship where you can. awesome-mcp-servers, Official Registry, and npm all support ESM fine.

### 26. Acknowledge Contributors Publicly
@aish-varya contributed audience/tone/platform detection via PR #1. Credited in CHANGELOG, README, and How I Built This. Specific feature attribution (not just "thanks") encourages future contributions.

---

## Security

### 27. Ed25519 from Node.js stdlib (Zero Crypto Dependencies)
Use built-in `crypto` module for key generation and signature verification. No npm packages for cryptography. Reduces supply-chain risk.

### 28. Ed25519 Key Rotation is Irreversible
Regenerating the keypair (`scripts/keygen.mjs init`) invalidates ALL existing license keys. The new public key won't verify old signatures. Back up the private key. Document the process. Never regenerate casually.

### 29. Input Hardening via Zod Schemas
Every tool input validated with Zod. Strings trimmed, max-length constrained, regex-validated. Session IDs sanitized to alphanumeric + hyphens. Prevents injection and path traversal at the API boundary.

### 30. Prompt Logging Opt-In Only
Raw prompt logging disabled by default. Only enabled with `PROMPT_OPTIMIZER_LOG_PROMPTS=true`. Prompts can contain API keys, business logic, private data — never log by default.

### 31. No Telemetry, No Phone-Home
Zero network calls from the MCP. No analytics, no usage tracking, no license server. All operations local. User trust through transparency.

### 32. License File Permissions (chmod 600)
License key stored with owner-only read/write. Best-effort on POSIX (skipped on Windows). Prevents other users on the same machine from reading your key.

---

## Testing

### 33. Contract Testing Over Integration Testing
`test/contracts.test.ts` verifies output shapes never change (PreviewPack, CostEstimate, LicenseData are frozen). Contracts are the API contract — if the shape changes, downstream tools break.

### 34. Exhaustive Freemium & Metering Tests
`test/freemium.test.ts` covers lifetime gates, pro bypass, rate limiter, monthly reset, metering-after-success invariant, and usage enforcement. 27 tests just for metering. Monetization code must be bulletproof.

### 35. E2E Pipeline Testing (Full Approve Flow)
`test/e2e.test.ts` runs: vague prompt → blocking questions → user answers → refine with higher score → approve → compiled prompt returned. The approval gate is only fully validated in E2E tests.

### 36. ~130 Tests Using Node's Built-In Test Runner
No Jest, no Vitest. `node --test` keeps the dependency count at 2. Tests serve as executable documentation — comments drift, tests don't.

---

## AI/LLM Integration

### 37. MCP as Co-Pilot for the Co-Pilot
The MCP doesn't replace Claude's intelligence; it structures it. Claude provides reasoning; the MCP provides discipline (scoring, compilation, cost visibility, approval gates). Aligned with how Claude works best — clear context and constraints produce more reliable results.

### 38. Task-Type-Aware Scoring
Scoring dimensions adapt per task type. Code tasks reward file paths and constraints; writing tasks reward audience, tone, platform, and length. One-size-fits-all scoring would penalize writing tasks for not having function names.

### 39. Model Recommendations by Risk and Task
High-risk (auth, payment, database) → Opus. Balanced → Sonnet. Writing-only → Haiku. Helps users make cost-effective choices without guessing.

### 40. Multi-Provider Cost Estimation
Pricing for 8 models across Anthropic, OpenAI, and Google in one view. Optimize for Claude but see what it costs on GPT-4o or Gemini.

---

## Process

### 41. 49 Hours Wall Clock, ~10 Hours Active
Three late-night sessions: Session 1 (5h43m), Session 2 (2h54m), Session 3 (1h49m). A production MCP with tests, docs, monetization, and distribution — built in spare time with AI pair programming. Short enough to hold the full architecture in your head.

### 42. Frequent Small Commits (~14 Minutes Apart)
21 commits, each atomic and descriptive. Small commits make rollback easy, diffs readable, and the git log a useful timeline.

### 43. Non-Engineer Building TypeScript with Claude Code
Rishi (talent acquisition director) specified architecture and interfaces; Claude Code implemented code + tests. AI pair programming produces production-grade code without the human being a language specialist.

### 44. CLAUDE.md as Living Architecture Document
`.claude/CLAUDE.md` documents build commands, file roles, test strategy, common pitfalls, npm publishing steps. Updated whenever architecture changes. Any future session can understand the project and make safe changes.

### 45. npm Token Confusion (Publish vs Automation)
"Automation" tokens don't require OTP — needed for scripted/CI publishing. "Publish" tokens require interactive OTP. Create exactly one Automation token, save to `.npmrc`. Documented in CLAUDE.md to prevent repeat mistakes.

### 46. Prepublish Hook for Safety
`"prepublishOnly": "npm run build"` in package.json ensures `dist/` is always rebuilt before publishing. Prevents accidentally shipping stale compiled code.

---

## Product Design

### 47. Problem-First Positioning
Five pain points → five features. Vague prompts → blocking questions. No structure → compilation. Invisible cost → cost estimator. Context bloat → compressor. No gate → approval flow. The product is cohesive around problems, not features.

### 48. Scoring Transparency (Every Point Explained)
48/100 → "Clarity 12/20 (vague objective), Specificity 8/20 (no file paths), Completeness 8/20 (no success criteria)." Users won't trust a black-box score. Transparency builds trust and shows exactly what to improve.

### 49. Ambiguity Detection is Task-Type Aware
`vague_objective` only applies to code tasks. Writing tasks aren't penalized for missing file paths. Research tasks get different rules than planning tasks. Fair scoring = trusted scoring.

### 50. The "Compilation" Metaphor
Calling it "compiling" a prompt is memorable and technically accurate — input is transformed, constraints enforced, output validated against a schema. Users understand what "compile" means.

---

## DX/UX

### 51. Before/After Delta as Primary Metric
"Your prompt improved from 48 to 90 (+42 points)" is more compelling than "Your prompt is 90/100." Deltas communicate value better than absolutes.

### 52. Compilation Checklist with Checkboxes
"✓ Role definition, ✓ Success criteria, ✓ Safety constraints, ✓ Workflow, ✓ Uncertainty policy" — makes the transformation visible and tangible. Users see exactly what was added.

### 53. Assumptive Blocking Questions
Questions guide users toward better prompts: "Which file(s) should this apply to?", "This touches a sensitive area — what are the boundaries?" They're not just data collection; they teach prompting.

### 54. Always-On Mode for Power Tier
Auto-optimize every prompt without explicit invocation. Converts the tool from "something I remember to use" to "something that just works." Makes Power tier feel genuinely premium.

---

## Deployment

### 55. Monolithic Build to Single dist/
TypeScript compiles both `src/` and `test/` to one `dist/` directory. Package.json `files` whitelist ships only built code. Simple, predictable distribution.

### 56. bin/cli.js as Shebang Entry Point
`#!/usr/bin/env node` shebang + package.json `bin` field makes `npx claude-prompt-optimizer-mcp` just work. Users don't need to know internal structure.

---

## Key Mistakes

### 57. Ed25519 Key Rotation is a One-Way Door
Regenerating the keypair invalidates every existing license. The first time this happened, it required a version bump (v2.2.1) just to publish the new public key. Back up the private key immediately after generation.

### 58. MCP Registry Requires mcpName Field
Discovered via trial-and-error. Required a version bump (v2.2.2) just to add `mcpName` to package.json. Read all registry docs before submitting.

### 59. Smithery Doesn't Support ESM
Top-level `await` in ESM breaks Smithery's CJS-only build. No workaround — just skip that directory and note the limitation.

### 60. Don't "Fix" Intentional Copy
Changed a GitHub profile tagline from "make hiring for great repeatable" to "make hiring great" thinking it was broken grammar. It was intentional — meaning "make the process of hiring for great [talent] repeatable." Always ask before changing someone's narrative.

---

> Built in 49 hours. 60 learnings. All reusable.
