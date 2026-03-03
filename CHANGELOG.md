# Changelog

## [4.1.0] - 2026-03-03

### Added — Enterprise Console Integration
- **Tool 20 — `save_custom_rules`** (FREE, Enterprise-only): Deploy custom governance rules built in the Enterprise Console directly to Prompt Control Plane. Validates all rules, sorts deterministically, writes with secure file permissions, and returns a rule-set hash for reproducibility.
- **Enterprise Console → Product bridge**: Build rules in the visual editor, click "Copy & Deploy", paste into any MCP-connected AI assistant — rules are active on the next optimization. Works with any LLM, not just Claude.

### Changed — Documentation & Governance
- **"Enterprise Features" section** in README: consolidated Enterprise Console, Policy Enforcement, Policy-Locked Configuration, Hash-Chained Audit Trail, Custom Governance Rules, Session Lifecycle, and Reproducible Exports into a dedicated section with pricing table rows.
- **Terminology**: "Tamper-evident" → "Hash-chained" across all 15 public docs. Product-facing language, not attack-implying.
- **Content filter**: Stripped all internal source paths, function names, type names, test counts, and implementation details from README, CHANGELOG, and all website pages.
- **Roadmap leak removed**: Phase A/B migration plans removed from docs.html and how-i-built-this.html.
- **Tool count**: Updated to 20 across all public docs (README, website meta tags, feature tables, proof grids).
- **Enterprise features on website**: Added Enterprise Console card to features.html, updated Custom Rules deploy flow on plans.html and docs.html, added `save_custom_rules` to tool tables.
- Tool count: 19 → 20

### Notes
- **No breaking changes** to existing 19 MCP tools, CLI, or programmatic API.
- New tool is FREE and unlimited (Enterprise tier required).
- Architecture constraint preserved: **zero LLM calls inside. Deterministic. Offline. Reproducible.**

## [4.0.3] - 2026-03-02

### Changed — Contact & Privacy
- **Contact page**: Broadened from Enterprise-only to general contact form with Subject dropdown (Enterprise, Security, Privacy, Legal, General, Other)
- **Email removal**: Replaced all exposed email addresses in privacy, terms, and security pages with contact form links
- **Footer**: Added "Contact" link to Legal column across all 14 pages
- **README**: Fixed GitHub Action references and PR link alignment
- **server.json**: Version aligned to match npm package

## [4.0.2] - 2026-03-01

### Changed — Cloudflare Pages Migration
- **Hosting**: Migrated from GitHub Pages to Cloudflare Pages (`prompt-control-plane.pages.dev`)
- **All URLs**: 20 files updated — canonical, OG, JSON-LD, curl install, ENTERPRISE_PURCHASE_URL
- **Blog links**: Removed from public navigation and footer (blog pages still accessible by direct URL)
- **Security headers**: `_headers` file with X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- **Custom 404**: Branded 404.html page matching site design
- **Redirects**: `_redirects` for old GitHub Pages paths

### Added — Business Website
- **6 new pages**: changelog, privacy policy, terms of service, security posture, blog index, 404
- **Trust signals**: Shields.io badges (npm version, downloads, GitHub release, ELv2 license) on homepage
- **3-column footer**: Product | Resources | Legal — standardized across all 14 pages
- **Legal pages**: Zero-data-collection privacy policy, ELv2 terms, CTO-facing security posture

## [4.0.0] - 2026-03-01

### Changed — Rebrand
- **Product brand**: "Prompt Optimizer MCP" → **Prompt Control Plane** (display name only)
- **npm package**: remains `claude-prompt-optimizer-mcp` (unchanged)
- **GitHub repo**: remains `rishiatlan/Prompt-Optimizer-MCP` (unchanged)
- **MCP config key**: remains `"prompt-optimizer"` (unchanged)
- **Environment variables**: `PROMPT_OPTIMIZER_*` → `PROMPT_CONTROL_PLANE_*` (legacy fallback supported)
- **Storage path**: `~/.prompt-optimizer/` → `~/.prompt-control-plane/`
- **License key prefix**: `po_pro_` → `pcp_`
- **localStorage key**: `po-theme` → `pcp-theme`
- **Tagline**: "The control plane for AI prompts"

### Added — Enterprise Tier Gates
- Enterprise-only settings in `configure_optimizer`: `policy_mode`, `audit_log`, `session_retention_days`
- Config lock/unlock requires Enterprise tier
- Custom rules integration gated to Enterprise in MCP tools (ungated in CLI linter)
- `tier_feature_unavailable` error response with upgrade URL
- New tier gate tests

### Changed — Docs Site
- Navigation updated across all pages: Home | Features | Models | Docs | Pricing
- New `plans.html` page for 4-tier pricing comparison with Enterprise Trust section
- New `docs.html` page with full developer documentation, architecture flowchart, PreviewPack reference
- Enterprise tier highlights: Policy Enforcement, Audit Logging, Config Lock, Custom Rules, Session Retention
- Hero section updated with new tagline and branding
- All meta/OG/Twitter descriptions updated

### Notes
- **No behavioral changes** to the core pipeline (scoring, routing, compression, compilation).
- Enterprise features properly tier-gated (were previously accessible to all tiers).
- Existing license keys with `po_pro_` prefix must be re-issued with `pcp_` prefix.
- Architecture constraint preserved: **zero LLM calls inside. Deterministic. Offline. Reproducible.**

## [3.3.0] - 2026-03-01

### Added
- **Policy enforcement mode**: `policy_mode` config (`advisory` | `enforce`). When set to `enforce`, BLOCKING rules (built-in + custom) block `optimize_prompt` and `approve_prompt`. Risk threshold gating blocks `approve_prompt` when score >= strictness threshold (relaxed=40, standard=60, strict=75).
- **Audit logging with hash chaining**: Opt-in JSONL audit trail. Local-only, append-only, never stores prompt content. Each entry includes an integrity hash linking every entry to its predecessor. If any line is deleted or modified, all subsequent hashes break — making unauthorized changes detectable.
- **Config lock mode**: Passphrase-protected config locking (`lock: true, lock_secret: "..."`) prevents unauthorized changes. Only the correct passphrase can unlock. Wrong attempts are audit-logged. Stored as SHA-256 hash — secret never persisted.
- **Tool 18 — `delete_session`** (FREE): Delete a single session by ID. Returns `deleted: true/false`.
- **Tool 19 — `purge_sessions`** (FREE): Safe-by-default session purge with `older_than_days`, `keep_last`, `purge_all`, `dry_run`. Three-tier resolution: explicit purge_all → age filter → config default → no-op.
- **`session_retention_days` config**: Optional auto-retention policy for `purge_sessions` default behavior.
- **Policy hash**: SHA-256 of built-in + custom rule-set hashes + policy mode + strictness. Included in `approve_prompt` success response and `export_session` metadata for reproducibility.
- **`policy_mode` in responses**: Visible in optimize_prompt, approve_prompt, pre_flight, and export_session outputs.
- New tests covering audit logging, session lifecycle, policy enforcement, and enterprise workflows.

### Changed
- Tool count: 17 → 19

### Notes
- **No breaking changes** to existing 17 MCP tools, CLI, or programmatic API.
- New tools are FREE and unlimited.
- Audit log is opt-in and local-only. Never stores prompt content. Hash-chained for integrity verification.
- Config lock uses passphrase-based protection (SHA-256 hash stored, secret never persisted). All lock/unlock/blocked attempts are audit-logged.
- Purge only deletes session data — never touches config, usage, license, audit, or custom rules.
- Architecture constraint preserved: **zero LLM calls inside. Deterministic. Offline. Reproducible.**

## [3.2.1] - 2026-03-01

### Added
- **Reproducible session exports**: Session exports now auto-calculate `rule_set_hash`, `rule_set_version`, and `risk_score` — no more placeholder values.
- **Custom rules integration**: User-defined regex rules for custom governance, CLI validation flag, and programmatic API support.
- New reproducibility tests covering version format, hash stability, and export auto-calculation.

### Notes
- **No breaking changes** to MCP tools, CLI, or programmatic API.
- Hash is portable across Node 18/20/22.
- Architecture constraint preserved: **zero LLM calls inside. Deterministic. Offline. Reproducible.**

## [3.1.0] - 2026-03-01

### Added
- **Smart Compression**: 5 deterministic heuristics — license block strip, comment collapse, duplicate collapse, stub collapse, aggressive middle truncation. Zone-aware: protects fenced code, tables, lists, and structured blocks from modification.
- **Tool Pruning** (`prune_tools`): Task-type-aware relevance scoring, mention protection, protected core tools
- **Pre-Flight Deltas**: Estimated token savings for compression and pruning shown before user commits
- **4 new risk rules**: Hallucination risk, agent underspec, conflicting constraints, token budget mismatch
- `compress_context` response now includes `heuristics_applied` and `mode` fields (backward-compatible)
- `pre_flight` now returns `compression_delta` conditionally when context is provided (token savings estimate)

### Changed
- Tool count: 14 → 15
- Rule count: 10 → 14

### Notes
- **No breaking changes** to existing tools, types, CLI, or GitHub Action. All 14 original MCP tools unchanged.
- New `prune_tools` tool is FREE and unlimited.
- Architecture constraint preserved: **zero LLM calls inside. Deterministic. Offline. Reproducible.**

## [3.0.0] - 2026-02-28

### Added
- **Reasoning Complexity Classifier**: Classifies prompts into 6 complexity types — `simple_factual`, `analytical`, `multi_step`, `creative`, `long_context`, `agent_orchestration`. Returns complexity, confidence, and signals.
- **Optimization Profiles**: 5 built-in presets — `cost_minimizer`, `balanced`, `quality_first`, `creative`, `enterprise_safe`. Each provides defaults for model tier, temperature, and sensitivity settings.
- **Model Routing Engine**: 2-step deterministic routing — (1) pick tier from complexity + risk, (2) apply budget/latency overrides. Returns recommendation with `decision_path` audit trail, savings estimate, confidence, and fallback model.
- **Risk Scoring**: Dimensional risk scoring across 4 axes (underspec, hallucination, scope, constraint). Score 0–100 drives routing decisions.
- **Perplexity support**: Sonar and Sonar Pro models added for cost estimation and routing. Included in pricing and routing recommendations only (not a compile/output target).
- **3 new capabilities** (14 total):
  - `classify_task` (FREE): Classify prompt by task type, complexity, risk, and suggested profile.
  - `route_model` (FREE): Route to optimal model with full `decision_path` audit trail.
  - `pre_flight` (METERED): Full pre-flight pipeline — classify, assess risk, route model, score quality. Counts as 1 optimization use.

### Changed
- **Model routing tiers**: Now uses provider-agnostic `small` / `mid` / `top` tier system.
- **Cost estimation**: Now includes Perplexity in cost comparison output.

### Notes
- **No breaking changes** to existing tools, types, or CLI. All 11 original MCP tools, `prompt-lint` CLI, and GitHub Action are unchanged. Existing linter workflows continue without modification.
- Architecture constraint preserved: **zero LLM calls inside. Deterministic. Offline. Reproducible.**
- `pre_flight` does NOT call `optimize_prompt` internally — no double-metering. `classify_task` + `route_model` are free and unlimited.
- Risk score (0–100) drives routing; `riskLevel` is derived for display only (`0-29=low`, `30-59=medium`, `60-100=high`).
- All v3 tool outputs include `schema_version: 1` for forward-compatible versioning.

## [2.3.2] - 2026-02-28

### Changed
- **GitHub Action**: Deterministic install path (`$RUNNER_TEMP/prompt-lint-$$`) instead of `mktemp`. Added `--ignore-scripts` for supply-chain hardening.
- **CI workflow**: Added `cache: 'npm'` to all `setup-node` steps for faster repeat runs.
- **README**: Added action internals note, SHA-pinned example, version mapping docs.

## [2.3.1] - 2026-02-28

### Fixed
- **GitHub Action**: `npx` cannot run secondary bins from multi-bin packages. Action now uses `npm install --prefix` + `node_modules/.bin/prompt-lint` for reliable invocation by remote users.

## [2.3.0] - 2026-02-28

### Added
- **`prompt-lint` CLI binary**: Standalone CLI linter for AI prompts. Reuses the existing scoring/rules engine with no MCP dependency. Supports `--file`, `--threshold`, `--strict`, `--relaxed`, `--json`, and stdin input. Exit codes: 0 (pass), 1 (fail), 2 (invalid input).
- **GitHub Action** (`action.yml`): Composite action to lint prompt files in CI. Drop `uses: rishiatlan/Prompt-Optimizer-MCP@v2` into any workflow.
- **CI test fixtures**: `test/fixtures/good-prompt.txt` and `bad-prompt.txt` for action self-testing.
- **Action self-test workflow**: `.github/workflows/action-selftest.yml` with pass, fail, strictness, and packaging jobs.
- Comprehensive CLI test suite with real exit-code verification.

### Changed
- **Positioning**: Prompt Optimizer MCP is now positioned as a **prompt linter** — "The Prompt Linter for LLM Applications." Existing functionality is unchanged; the framing better reflects what the tool does (scoring, analysis, standardization).
- **Landing page**: Hero, SEO meta tags, use cases, and comparison section updated to linter framing. Added "For CI/CD pipelines" use case with real workflow snippet.
- **README**: Tagline, "Why This Exists", and new CI Integration section with CLI + GitHub Action examples.
- **package.json**: Updated description, keywords (`prompt-linter`, `lint`, `prompt-quality`), homepage → GitHub Pages URL.
- **server.json**: Description updated to linter framing.

### Migration
- No breaking changes. All 11 MCP tools, programmatic API, and install commands are unchanged.
- New `prompt-lint` binary ships alongside existing `claude-prompt-optimizer-mcp` binary.
- New dependency: `fast-glob` (for CLI file globbing in CI environments).

## [2.2.3] - 2026-02-28

### Changed
- **npm README sync**: Published updated README with human-in-the-loop approval documentation, approval loop subsection, and backfilled CHANGELOG to npm.

## [2.2.2] - 2026-02-28

### Added
- **Human-in-the-loop approval documentation**: Documented the mandatory approval gate (`optimize_prompt` → `refine_prompt` → `approve_prompt`) across README and landing page. The gate was always enforced in code — now it's prominently documented.
- **Interactive before/after demo**: Landing page hero section now shows a live quality transformation example.
- **Acknowledgments section**: Credited @aish-varya for PR #1 contributions.
- **MCP Registry listing**: `server.json` added for MCP Registry publication + submitted to 6+ directories.

### Changed
- **Repository renamed**: `Claude-Prompt-Optimizer` → `Prompt-Optimizer-MCP` (npm package name unchanged).
- **MCP Registry identifier**: Fixed from `claude-prompt-optimizer` to `prompt-optimizer-mcp` in `server.json`.

## [2.2.1] - 2026-02-27

### Changed
- Republished with new Ed25519 public key to npm.
- Added npm publish workflow documentation to CLAUDE.md.

## [2.2.0] - 2026-02-27

### Added
- **Programmatic API**: `import { createOptimizer } from 'claude-prompt-optimizer-mcp'` for direct integration.
- **Dual entry points**: MCP server (stdio) + programmatic API from single package.
- **Curl installer**: `curl -fsSL https://prompt-control-plane.pages.dev/install.sh | bash`
- **E2E tests**: End-to-end tests covering the full optimize → refine → approve flow.
- **Landing page**: GitHub Pages product site with interactive demo and pricing.

## [2.1.0] - 2026-02-27

### Added
- **3-tier pricing system**: Free (₹0, 10 lifetime), Pro (₹499/mo, 100/month), Power (₹899/mo, unlimited)
- **Ed25519 offline license activation**: `set_license` and `license_status` tools — no backend, no phone-home
- **Monthly usage enforcement**: Calendar-month reset, tracked per-user in local storage
- **6 new tools**: `check_prompt`, `configure_optimizer`, `get_usage`, `prompt_stats`, `set_license`, `license_status` (total: 11 tools)
- **Persistent file-based storage**: Sessions, usage, config, stats, and license data persisted locally
- **Multi-LLM output targets**: Claude (XML), OpenAI (system/user split), Generic (Markdown)
- **Rate limiting**: Tier-keyed sliding window (free=5/min, pro=30/min, power=60/min)
- **Usage metering**: Lifetime + monthly counters with metering-after-success invariant
- **Statistics tracking**: Total optimized, avg score before, task type distribution, estimated cost savings
- **Configuration tool**: Set mode, threshold, strictness, target, ephemeral mode, session limits
- **Multi-provider cost estimation**: Added OpenAI and Google model pricing alongside Anthropic
- **Structured logging**: Request ID correlation, log levels, optional prompt logging
- **Deterministic ordering**: All array fields sorted consistently for reproducibility
- **GitHub Pages landing page**: `docs/index.html` with quality-first positioning
- **License key generator**: Ed25519 keypair + batch key generation tooling
- Comprehensive automated test suite

### Changed
- `quality_after` replaced with `compilation_checklist` (structural coverage, not numeric score)
- All responses now include `request_id` for traceability (success and error paths)
- Scoring max changed from 96 to 100
- Sessions backed by persistent storage (was in-memory only)

### Breaking Changes (v1 → v2)
- `quality_after` removed — use `compilation_checklist` instead
- `CostEstimate.costs` now includes OpenAI + Google models (was Anthropic-only)
- `compilePrompt()` requires `target: OutputTarget` parameter
- Session state persisted to disk (was in-memory only)

## [1.2.0] - 2026-02-26

### Added
- Audience/tone/platform detection (19 audience patterns, 9 platforms)
- Goal enrichment per task type
- `generic_vague_ask` rule for ultra-vague prompts
- CLI flags (`--version`, `--help`)
- NPM package distribution

## [1.0.0] - 2026-02-26

### Added
- Initial release with 5 MCP tools
- 9 deterministic ambiguity detection rules
- Quality scoring (0-100) with 5 dimensions
- Cost estimation with per-model breakdown
- Context compression
- Session-based state with sign-off gate
- 13 task types with intent-first detection
