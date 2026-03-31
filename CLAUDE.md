# PCP -- Prompt Control Plane

## What This Is
PCP is a deterministic prompt quality engine -- it scores, compiles, and optimizes prompts for LLMs without making any LLM calls itself. It runs as an MCP server, CLI tool, and programmatic API.

## Architecture

### Core Pipeline (8 Phases)
1. **Harden** -- Input sanitization (null bytes, whitespace capping)
2. **Freemium Gate** -- Tier/rate limit enforcement
3. **Policy Gate** -- Enterprise policy enforcement (advisory/enforce modes)
4. **Analyze** -- Intent decomposition via `analyzer.ts` (task type, risk level, inputs, constraints)
5. **Score** -- 5-dimension quality scoring via `scorer.ts` (clarity, specificity, completeness, constraints, efficiency)
6. **Compile** -- Structured prompt generation via `compiler.ts` (Claude XML / OpenAI / Generic markdown)
7. **Estimate** -- Multi-provider cost estimation via `estimator.ts` (10 models, 4 providers)
8. **Build & Return** -- PreviewPack assembly with metadata

### Entry Points
- `src/index.ts` -- MCP server (stdio transport)
- `src/lint-cli.ts` -- CLI tool (`pcp` / `prompt-lint`)
- `src/api.ts` -- Programmatic barrel export (pure functions)

### Key Files
| File | Purpose |
|------|---------|
| `tools/core.ts` | Core MCP tool registrations (optimize, refine, preflight, check) |
| `tools/analysis.ts` | Analysis MCP tools (approve, cost, compress, classify, route, stats, prune) |
| `tools/admin.ts` | Admin MCP tools (config, usage, license, custom rules) |
| `tools/sessions.ts` | Session MCP tools (list, export, delete, purge) |
| `tools/helpers.ts` | Shared helpers, purchase URLs, context builder |
| `tools/index.ts` | Barrel — creates MCP server, calls all register functions |
| `analyzer.ts` | Intent decomposition, task detection |
| `compiler.ts` | Prompt compilation to structured formats |
| `scorer.ts` | 5-dimension quality scoring (0-100) |
| `estimator.ts` | Token/cost estimation, model routing |
| `rules.ts` | 14 deterministic prompt quality rules |
| `customRules.ts` | User-defined rule management with ReDoS protection |
| `storage/localFs.ts` | File-based storage with path traversal prevention |
| `license.ts` | Ed25519 offline license validation |
| `auditLog.ts` | Hash-chained audit trail |
| `policy.ts` | Enterprise policy enforcement |
| `session.ts` | Multi-turn session management |
| `sessionHistory.ts` | Session history tracking |
| `rateLimit.ts` | In-memory rate limiter |
| `logger.ts` | Structured logging with privacy controls |
| `tokenizer.ts` | Token counting utilities |
| `templates.ts` | Prompt templates |
| `profiles.ts` | Optimization profiles |
| `pruner.ts` | Tool pruning logic |
| `deltas.ts` | Compression delta calculations |
| `preservePatterns.ts` | Pattern preservation during optimization |
| `zones.ts` | Zone-based prompt segmentation |
| `constants.ts` | Shared constants |
| `types.ts` | TypeScript type definitions |
| `sort.ts` | Deterministic sorting utilities |

### Dependencies
- 3 runtime: `@modelcontextprotocol/sdk` (^1.29.0), `zod`, `fast-glob`
- 0 vulnerabilities (verified via `npm audit`)

### Data Directory
`~/.prompt-control-plane/` contains:
- `usage.json` -- Tier, optimization counts, period tracking
- `config.json` -- User configuration (mode, threshold, strictness)
- `stats.json` -- Aggregated statistics
- `license.json` -- License key data (chmod 600)
- `audit.log` -- Hash-chained audit trail
- `custom-rules.json` -- User-defined rules
- `sessions/` -- Multi-turn session state

## Build & Test
```bash
npm ci && npm run build    # Install + compile
npm test                   # Run 832 tests
npx tsc --noEmit          # Type check only
```

## Key Design Decisions
- **Zero LLM calls** -- All analysis is regex-based and deterministic
- **Deterministic outputs** -- Same input always produces same score/output
- **Fail-open by default** -- Storage errors don't block usage (except in enforce mode)
- **Ed25519 licensing** -- Offline validation, no phone-home
- **Privacy-first** -- Prompts never logged by default, no telemetry

## Security Infrastructure
- `SECURITY.md` -- Vulnerability reporting policy, SLA, security model documentation
- `.github/dependabot.yml` -- Weekly npm + GitHub Actions dependency updates (grouped minor/patch)
- `.github/workflows/codeql.yml` -- Weekly CodeQL analysis with security-extended queries
- **Secret scanning + push protection** enabled via GitHub repo settings
- **Dependabot vulnerability alerts** enabled
- Security contact: hello@getpcp.site

## Common Tasks
- Adding a new MCP tool: Add to the appropriate file in `src/tools/` (`core.ts`, `analysis.ts`, `admin.ts`, or `sessions.ts`), register with `server.tool()` inside that file's `register*Tools()` function
- Adding a scoring dimension: Edit `scorer.ts`, update `scorePrompt()`
- Adding a new rule: Edit `rules.ts`, add to `RULES` array
- Adding model pricing: Edit `estimator.ts`, update `PRICING_DATA`
