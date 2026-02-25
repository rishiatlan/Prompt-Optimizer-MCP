# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

An MCP (Model Context Protocol) server that optimizes prompts for maximum impact and minimum cost with Claude. Acts as a **deterministic prompt compiler + contract enforcer** — turns raw user intent into a structured, constrained, reviewable prompt bundle with a sign-off gate before execution.

**Zero LLM calls inside the MCP.** All intelligence comes from the host Claude. The MCP provides structure, rules, and discipline.

## Build & Run

```bash
npm run build    # tsc → dist/
npm run start    # node dist/index.js
```

No test suite, no linter. The project is validated by manual JSON-RPC testing (see Testing section below).

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

### Key Architectural Pattern: Task-Type Polymorphism

The entire pipeline adapts behavior based on `TaskType`. Every module branches on whether the prompt is code, prose, research, etc:

- **analyzer.ts** — non-code patterns checked FIRST to prevent misclassification (a Slack post mentioning "fix the bug" as an example must match `writing`, not `debug`)
- **rules.ts** — each rule has an `applies_to` field (`'code' | 'prose' | 'all'`). Code-only rules (vague_objective, missing_target, scope_explosion) skip for writing tasks.
- **scorer.ts** — code tasks reward file paths; prose tasks reward audience/tone/platform/length
- **compiler.ts** — code tasks get "Do not modify files outside scope"; prose tasks get "Match the intended tone and audience"
- **estimator.ts** — output token estimates and model recommendations vary by task type
- **templates.ts** — role descriptions and workflow steps are task-type specific

The helpers `isCodeTask()` and `isProseTask()` in `types.ts` drive this branching.

### 13 Task Types

Code: `code_change`, `question`, `review`, `debug`, `create`, `refactor`
Non-code: `writing`, `research`, `planning`, `analysis`, `communication`, `data`
Fallback: `other`

Detection priority in `analyzer.ts`: non-code patterns are evaluated before code patterns to prevent false positives from prose that mentions code concepts.

## 5 MCP Tools

| Tool | Purpose | Stateful? |
|------|---------|-----------|
| `optimize_prompt` | Main entry: analyze → score → compile → estimate cost → return PreviewPack | Creates session |
| `refine_prompt` | Iterative: answer questions, add edits → updated PreviewPack | Updates session |
| `approve_prompt` | Sign-off gate: returns final compiled prompt. **Refuses** if blocking questions remain. | Finalizes session |
| `estimate_cost` | Standalone token + cost estimator for any text | No |
| `compress_context` | Prune irrelevant context, report token savings | No |

## File Roles

| File | Role |
|------|------|
| `src/index.ts` | Entry point — MCP server + stdio transport wiring |
| `src/tools.ts` | 5 MCP tool registrations with Zod schemas (thin wiring layer) |
| `src/analyzer.ts` | Intent decomposition: raw prompt → IntentSpec. Priority-ordered task detection, audience/tone detection, task-aware constraint extraction. |
| `src/compiler.ts` | Prompt compilation: IntentSpec → XML-tagged prompt. Task-type-aware constraints. |
| `src/estimator.ts` | Token counting (`ceil(len/4)`), per-model cost estimation, task-aware model recommendations |
| `src/scorer.ts` | Quality scoring (0-100, 5 dimensions × 20 points). Task-type-aware specificity scoring. |
| `src/rules.ts` | 9 deterministic ambiguity detection rules with `applies_to` field |
| `src/templates.ts` | `Record<TaskType, string>` for roles and workflows — must include ALL 13 task types |
| `src/session.ts` | In-memory `Map<string, Session>` with 30min TTL |
| `src/types.ts` | All TypeScript interfaces + `isCodeTask()`/`isProseTask()` helpers |

## Ambiguity Rules (9 deterministic checks)

| Rule | Applies To | Severity | Trigger |
|------|-----------|----------|---------|
| `vague_objective` | code | BLOCKING | Vague terms without a specific target |
| `missing_target` | code | BLOCKING | Code task with no file/function/module reference |
| `scope_explosion` | code | BLOCKING | "all", "everything", "entire" without scoping nouns (25-char lookahead window) |
| `high_risk_domain` | code | NON-BLOCKING | Auth, payment, database, production keywords |
| `no_constraints_high_risk` | code | BLOCKING | High-risk task with zero constraints |
| `format_ambiguity` | all | NON-BLOCKING | Mentions JSON/YAML but no schema |
| `multi_task_overload` | all | NON-BLOCKING | 3+ task indicators in one prompt |
| `missing_audience` | prose | NON-BLOCKING | No target audience specified |
| `no_clear_ask` | prose | NON-BLOCKING | No clear communication goal |

Hard caps: max 3 blocking questions, max 5 assumptions per cycle.

## Key Design Decisions

1. **Deterministic only** — No LLM calls inside the MCP. Rules, regex, heuristics.
2. **Sign-off gate** — `approve_prompt` refuses if blocking questions remain unanswered.
3. **Task-type polymorphism** — Every module adapts behavior via `isCodeTask()`/`isProseTask()`.
4. **Detection priority** — Non-code patterns checked first in `analyzer.ts` to prevent misclassification.
5. **XML-tagged output** — Anthropic-optimized prompt structure (role, goal, constraints, workflow).
6. **Session-based state** — In-memory Map, 30min TTL, single-client stdio transport.

## Common Pitfalls

- **Adding a new TaskType**: You must update `types.ts` (union + helper functions), `templates.ts` (both `ROLES` and `WORKFLOWS` are `Record<TaskType, string>` — TypeScript will error if a key is missing), `analyzer.ts` (detection patterns), `estimator.ts` (output token estimate + model recommendation), and `analyzer.ts` `extractDefinitionOfDone` (default DoD).
- **Regex false positives**: The `scope_explosion` rule uses a 25-char lookahead window to allow "all existing tests" while catching "fix all". If adjusting, test with both "refactor all the code" (should trigger) and "pass all existing tests in auth.test.ts" (should NOT trigger).
- **Detection order matters**: In `analyzer.ts`, `TASK_TYPE_PATTERNS` is evaluated top-to-bottom, first match wins. More specific patterns (data before analysis, writing before debug) must appear earlier.

## Testing

No test framework. Manual testing via JSON-RPC over stdin:

```bash
# Single prompt test
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"optimize_prompt","arguments":{"raw_prompt":"YOUR PROMPT HERE"}}}\n' | node dist/index.js 2>/dev/null | tail -1 | python3 -c "import sys,json; d=json.loads(json.loads(sys.stdin.read())['result']['content'][0]['text']); print('type:', d['intent_spec']['task_type'], '| risk:', d['intent_spec']['risk_level'], '| BQs:', len(d['blocking_questions']), '| score:', d['quality_before']['total'], '→', d['quality_after']['total'])"
```

Key test cases to verify after changes:
- Writing task: `"Write a Slack post for my team"` → type=writing, risk=low, 0 blocking questions
- Code task: `"Add validation to src/routes/users.ts"` → type=code_change, risk=medium
- Vague task: `"make it better"` → blocking questions fired
- Data task: `"Transform this CSV to group by department"` → type=data, model=haiku

Each `printf | node` invocation creates a new process (sessions don't persist across runs). For multi-step flows (refine/approve), use Python `subprocess.Popen` to keep one process alive.
