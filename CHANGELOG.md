# Changelog

## [2.2.2] - 2026-02-28

### Added
- **Human-in-the-loop approval documentation**: Documented the mandatory approval gate (`optimize_prompt` → `refine_prompt` → `approve_prompt`) across README, landing page, and How I Built This articles. The gate was always enforced in code — now it's prominently documented.
- **How I Built This**: Non-technical article published in both Markdown and HTML (GitHub Pages), with real git-log timeline and build narrative.
- **Interactive before/after demo**: Landing page hero section now shows a live quality transformation example.
- **Acknowledgments section**: Credited @aish-varya for PR #1 contributions in How I Built This docs.
- **MCP Registry listing**: `server.json` added for MCP Registry publication + submitted to 6+ directories.

### Changed
- **Repository renamed**: `Claude-Prompt-Optimizer` → `Prompt-Optimizer-MCP` (npm package name unchanged).
- **MCP Registry identifier**: Fixed from `claude-prompt-optimizer` to `prompt-optimizer-mcp` in `server.json`.
- **Technical How I Built This removed**: Kept non-technical version only to protect product IP.

## [2.2.1] - 2026-02-27

### Changed
- Republished with new Ed25519 public key to npm.
- Added npm publish workflow documentation to CLAUDE.md.

## [2.2.0] - 2026-02-27

### Added
- **Programmatic API**: `import { createOptimizer } from 'claude-prompt-optimizer-mcp'` for direct integration.
- **Dual entry points**: MCP server (stdio) + programmatic API from single package.
- **Curl installer**: `curl -fsSL https://rishiatlan.github.io/Prompt-Optimizer-MCP/install.sh | bash`
- **E2E tests**: End-to-end tests covering the full optimize → refine → approve flow.
- **Landing page**: GitHub Pages product site with interactive demo and pricing.

## [2.1.0] - 2026-02-27

### Added
- **3-tier pricing system**: Free ($0, 10 lifetime), Pro ($4.99/mo, 100/month), Power ($9.99/mo, unlimited)
- **Ed25519 offline license activation**: `set_license` and `license_status` tools — no backend, no phone-home
- **Monthly usage enforcement**: Calendar-month reset, tracked per-user in local storage
- **6 new tools**: `check_prompt`, `configure_optimizer`, `get_usage`, `prompt_stats`, `set_license`, `license_status` (total: 11 tools)
- **Persistent file-based storage**: `~/.prompt-optimizer/` with async StorageInterface (sessions, usage, config, stats, license)
- **Multi-LLM output targets**: Claude (XML), OpenAI (system/user split), Generic (Markdown)
- **Rate limiting**: Tier-keyed sliding window (free=5/min, pro=30/min, power=60/min)
- **Usage metering**: Lifetime + monthly counters with metering-after-success invariant
- **Statistics tracking**: Total optimized, avg score before, task type distribution, estimated cost savings
- **Configuration tool**: Set mode, threshold, strictness, target, ephemeral mode, session limits
- **Multi-provider cost estimation**: Added OpenAI and Google model pricing alongside Anthropic
- **Structured logging**: Request ID correlation, log levels, optional prompt logging
- **Deterministic ordering**: All array fields sorted consistently via `src/sort.ts`
- **GitHub Pages landing page**: `docs/index.html` with quality-first positioning
- **License key generator**: `scripts/keygen.mjs` for Ed25519 keypair + batch key generation
- **98 automated tests** across 7 test files (scorer, compiler, storage, freemium, contracts, security, license)

### Changed
- `quality_after` replaced with `compilation_checklist` (structural coverage, not numeric score)
- `PreviewPack` now includes `request_id`, `target`, `format_version: 1`, `scoring_version: 2`, `storage_health?`
- All responses include `request_id` (success and error paths)
- Scoring max changed from 96 to 100 (scoring_version: 2)
- Sessions backed by async StorageInterface (was sync in-memory Map)
- Package entry point moved to `dist/src/index.js` (was `dist/index.js`)

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
