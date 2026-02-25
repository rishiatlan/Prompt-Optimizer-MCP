# CLAUDE.md

## What This Project Is

An MCP (Model Context Protocol) server that optimizes prompts for maximum impact and minimum cost with Claude. Acts as a **deterministic prompt compiler + contract enforcer** — turns raw user intent into a structured, constrained, reviewable prompt bundle with a sign-off gate before execution.

**Zero LLM calls inside the MCP.** All intelligence comes from the host Claude. The MCP provides structure, rules, and discipline.

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

## Tech Stack

- TypeScript (ES2022, strict mode)
- `@modelcontextprotocol/sdk` ^1.25.2 — MCP server + stdio transport
- `zod` ^3.25.0 — input validation

## 5 MCP Tools

| Tool | Purpose | Stateful? |
|------|---------|-----------|
| `optimize_prompt` | Main entry: analyze → score → compile → estimate cost → return PreviewPack | Creates session |
| `refine_prompt` | Iterative: answer questions, add edits → updated PreviewPack | Updates session |
| `approve_prompt` | Sign-off gate: returns final compiled prompt | Finalizes session |
| `estimate_cost` | Standalone token + cost estimator for any text | No |
| `compress_context` | Prune irrelevant context, report token savings | No |

## File Roles

| File | Role |
|------|------|
| `src/index.ts` | Entry point — MCP server + stdio transport wiring |
| `src/tools.ts` | 5 MCP tool registrations with Zod schemas |
| `src/analyzer.ts` | Intent decomposition: raw prompt → IntentSpec |
| `src/compiler.ts` | Prompt compilation: IntentSpec → XML-tagged prompt |
| `src/estimator.ts` | Token counting + cost estimation + model recommendation |
| `src/scorer.ts` | Quality scoring (0-100) with 5 dimensions |
| `src/rules.ts` | Deterministic ambiguity detection rules (7 rules) |
| `src/templates.ts` | Role and workflow templates per task type |
| `src/session.ts` | In-memory session store with 30min TTL |
| `src/types.ts` | All TypeScript interfaces |

## Key Design Decisions

1. **Deterministic only** — No LLM calls inside the MCP. Rules, regex, heuristics.
2. **Sign-off gate** — `approve_prompt` refuses if blocking questions remain unanswered.
3. **Hard caps** — Max 3 blocking questions, max 5 assumptions per cycle.
4. **Quality scoring** — 5 dimensions × 20 points = 0-100 score with before/after delta.
5. **XML-tagged output** — Anthropic-optimized prompt structure (role, goal, constraints, workflow, etc.).
6. **Session-based state** — In-memory Map, 30min TTL, single-client stdio transport.

## Build & Run

```bash
npm run build    # tsc → dist/
npm run start    # node dist/index.js
```

## Ambiguity Rules (7 deterministic checks)

| Rule | Severity | Trigger |
|------|----------|---------|
| `vague_objective` | BLOCKING | Vague terms without a specific target |
| `missing_target` | BLOCKING | Code task with no file/function/module reference |
| `scope_explosion` | BLOCKING | "all", "everything", "entire" without boundaries |
| `format_ambiguity` | NON-BLOCKING | Mentions JSON/YAML but no schema |
| `high_risk_domain` | NON-BLOCKING | Auth, payment, database, production keywords |
| `no_constraints_high_risk` | BLOCKING | High-risk task with zero constraints |
| `multi_task_overload` | NON-BLOCKING | 3+ task indicators in one prompt |
