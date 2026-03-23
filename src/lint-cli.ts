// src/lint-cli.ts — Prompt Control Plane CLI (v5.0.0).
// Full subcommand suite: optimize, classify, route, compress, cost, check, score, preflight, config, doctor, hook.
// Reuses pure API functions from api.ts. No MCP server, no sessions.
// CLI reads governance config (written by Enterprise Console) — never writes it.

import { readFileSync, writeFileSync, statSync, readdirSync, existsSync, mkdirSync, chmodSync, unlinkSync, renameSync } from 'node:fs';
import { resolve, extname, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  analyzePrompt, detectTaskType, scorePrompt, runRules,
  classifyComplexity, compressContext, estimateCost, estimateTokens,
  routeModel, computeRiskScore, optimize,
  evaluatePolicyViolations, checkRiskThreshold,
} from './api.js';
import type { OutputTarget, OptimizerConfig } from './types.js';
import { sortIssues } from './sort.js';
import { customRules } from './customRules.js';

// ─── Version ─────────────────────────────────────────────────────────────────

const __lint_dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__lint_dirname, '..', '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const VERSION: string = pkg.version;

// ─── Binary Name Detection ──────────────────────────────────────────────────

const BIN_NAME = basename(process.argv[1] || '').replace(/\.js$/, '') === 'pcp' ? 'pcp' : 'prompt-lint';

// ─── Data Directory ─────────────────────────────────────────────────────────

const DATA_DIR = process.env.PCP_DATA_DIR || join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.prompt-control-plane',
);

// ─── Thresholds ─────────────────────────────────────────────────────────────

const THRESHOLDS = { relaxed: 40, standard: 60, strict: 75 } as const;

// ─── Context Size Warning ───────────────────────────────────────────────────

const CONTEXT_SIZE_WARNING_BYTES = 500 * 1024; // 500KB

// ─── Subcommand Registry ────────────────────────────────────────────────────

const SUBCOMMANDS = new Set([
  'optimize', 'classify', 'route', 'compress', 'cost',
  'check', 'score', 'preflight', 'config', 'doctor', 'hook',
  'demo', 'report', 'badge', 'benchmark',
]);

// ─── Types ──────────────────────────────────────────────────────────────────

interface LintResult {
  source: string;
  score: number;
  pass: boolean;
  confidence?: 'low' | 'medium' | 'high';
  issues: Array<{ rule: string; severity: string; message: string }>;
}

interface SubcommandArgs {
  help: boolean;
  json: boolean;
  quiet: boolean;
  pretty: boolean;
  target: OutputTarget;
  context: string | null;
  contextFile: string | null;
  fileArg: string | null;
  promptArg: string | null;
  intent: string | null;
  show: boolean;  // for config --show
  // check-specific flags (backward compat)
  strict: boolean;
  relaxed: boolean;
  threshold: number | null;
  fileArgs: string[];  // check supports multiple --file
  validateCustomRules: boolean;
  format?: 'github' | 'human';
  warnOnly?: boolean;
  outputDir?: string;
}

// ─── Error Codes ───────────────────────────────────────────────────────────

const ERROR_CODES: Record<string, { code: string; suggestion: string }> = {
  'No prompt provided': {
    code: 'E_NO_INPUT',
    suggestion: "Try: pcp demo | pcp --help | pcp check 'your prompt'",
  },
  'File is empty': {
    code: 'E_EMPTY_FILE',
    suggestion: 'Check the file path and ensure it contains text.',
  },
  'Unknown flag': {
    code: 'E_UNKNOWN_FLAG',
    suggestion: 'Run pcp --help to see available options.',
  },
  'Policy blocked': {
    code: 'E_POLICY_BLOCKED',
    suggestion: 'Check your policy configuration with: pcp config',
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function fatal(message: string, jsonMode: boolean, exitCode: number = 2): never {
  // Look up structured error code by matching message prefix
  let errorCode: string | undefined;
  let suggestion: string | undefined;
  for (const [prefix, info] of Object.entries(ERROR_CODES)) {
    if (message.startsWith(prefix)) {
      errorCode = info.code;
      suggestion = info.suggestion;
      break;
    }
  }

  if (jsonMode) {
    const errorObj: Record<string, unknown> = { code: exitCode, message };
    if (errorCode) errorObj.error_code = errorCode;
    if (suggestion) errorObj.suggestion = suggestion;
    process.stdout.write(JSON.stringify({ error: errorObj }, null, 2) + '\n');
  } else {
    if (errorCode) {
      process.stderr.write(`Error [${errorCode}]: ${message}\n  Hint: ${suggestion}\n`);
    } else {
      process.stderr.write(`Error: ${message}\n`);
    }
  }
  process.exit(exitCode);
}

function generateRequestId(): string {
  return randomUUID();
}

/** Normalize CRLF to LF. */
function normalizeCrlf(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Read governance config from local storage. Read-only. */
function loadConfig(): Partial<OptimizerConfig> {
  const configPath = join(DATA_DIR, 'config.json');
  try {
    if (existsSync(configPath)) {
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    }
  } catch {
    // Corrupt or missing — return defaults
  }
  return {};
}

/** Get the effective policy mode from config. */
function getPolicyMode(): string {
  const config = loadConfig();
  return config.policy_mode || 'advisory';
}

/** Get the effective strictness from config. */
function getStrictness(): string {
  const config = loadConfig();
  return config.strictness || 'standard';
}

/** Build consistent JSON envelope. */
function envelope(subcommand: string, data: Record<string, unknown>): Record<string, unknown> {
  return {
    request_id: generateRequestId(),
    version: VERSION,
    schema_version: 1,
    subcommand,
    policy_mode: getPolicyMode(),
    ...data,
  };
}

/** Write JSON output respecting --pretty flag. */
function writeJson(data: unknown, args: { pretty: boolean }): void {
  const indent = args.pretty ? 2 : (process.stdout.isTTY ? 2 : 0);
  process.stdout.write(JSON.stringify(data, null, indent) + '\n');
}

// ─── Shared Input Resolution ────────────────────────────────────────────────

async function resolveInput(args: SubcommandArgs): Promise<string> {
  if (args.fileArg) {
    const raw = readFileSync(resolve(args.fileArg), 'utf-8');
    const text = normalizeCrlf(raw).trim();
    if (!text) fatal('File is empty.', args.json);
    return text;
  }
  if (args.promptArg) {
    const text = normalizeCrlf(args.promptArg).trim();
    if (!text) fatal('Prompt is empty.', args.json);
    return text;
  }
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const text = normalizeCrlf(Buffer.concat(chunks).toString('utf-8')).trim();
    if (!text) fatal('No input provided via stdin.', args.json);
    return text;
  }
  fatal('No prompt provided. Pass as argument, --file, or pipe via stdin.', args.json);
}

function resolveContext(args: SubcommandArgs): string | undefined {
  if (args.contextFile) {
    const raw = readFileSync(resolve(args.contextFile), 'utf-8');
    const text = normalizeCrlf(raw);
    // Size warning
    if (raw.length > CONTEXT_SIZE_WARNING_BYTES) {
      const tokens = estimateTokens(text);
      process.stderr.write(`Warning: Context file is large (~${tokens} tokens). Consider using 'pcp compress' first.\n`);
    }
    return text;
  }
  if (args.context) return normalizeCrlf(args.context);
  return undefined;
}

// ─── Subcommand Arg Parsing ─────────────────────────────────────────────────

function parseSubcommandArgs(argv: string[]): SubcommandArgs {
  const result: SubcommandArgs = {
    help: false,
    json: false,
    quiet: false,
    pretty: false,
    target: 'claude' as OutputTarget,
    context: null,
    contextFile: null,
    fileArg: null,
    promptArg: null,
    intent: null,
    show: false,
    strict: false,
    relaxed: false,
    threshold: null,
    fileArgs: [],
    validateCustomRules: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--json') {
      result.json = true;
    } else if (arg === '--quiet' || arg === '-q') {
      result.quiet = true;
    } else if (arg === '--pretty') {
      result.pretty = true;
    } else if (arg === '--target') {
      i++;
      if (i >= argv.length) fatal('--target requires a value', result.json);
      const val = argv[i];
      if (val !== 'claude' && val !== 'openai' && val !== 'generic') {
        fatal(`--target must be claude, openai, or generic, got: ${val}`, result.json);
      }
      result.target = val as OutputTarget;
    } else if (arg === '--context') {
      i++;
      if (i >= argv.length) fatal('--context requires a value', result.json);
      result.context = argv[i];
    } else if (arg === '--context-file') {
      i++;
      if (i >= argv.length) fatal('--context-file requires a value', result.json);
      result.contextFile = argv[i];
    } else if (arg === '--file' || arg === '-f') {
      i++;
      if (i >= argv.length) fatal('--file requires a value', result.json);
      // For check mode backward compat, support multiple --file
      result.fileArgs.push(argv[i]);
      if (!result.fileArg) result.fileArg = argv[i];
    } else if (arg === '--intent') {
      i++;
      if (i >= argv.length) fatal('--intent requires a value', result.json);
      result.intent = argv[i];
    } else if (arg === '--show') {
      result.show = true;
    } else if (arg === '--strict') {
      result.strict = true;
    } else if (arg === '--relaxed') {
      result.relaxed = true;
    } else if (arg === '--threshold') {
      i++;
      if (i >= argv.length) fatal('--threshold requires a value', result.json);
      const val = Number(argv[i]);
      if (!Number.isInteger(val) || val < 0 || val > 100) {
        fatal(`--threshold must be an integer 0-100, got: ${argv[i]}`, result.json);
      }
      result.threshold = val;
    } else if (arg === '--format') {
      i++;
      if (i >= argv.length) fatal('--format requires a value', result.json);
      const fmt = argv[i];
      if (fmt === 'json') result.json = true;
      else if (fmt === 'github') result.format = 'github';
      else if (fmt !== 'human') fatal(`--format must be human, json, or github, got: ${fmt}`, result.json);
    } else if (arg === '--warn-only') {
      result.warnOnly = true;
    } else if (arg === '--output') {
      i++;
      if (i >= argv.length) fatal('--output requires a value', result.json);
      result.outputDir = argv[i];
    } else if (arg === '--validate-custom-rules') {
      result.validateCustomRules = true;
    } else if (arg.startsWith('-')) {
      fatal(`Unknown flag: ${arg}`, result.json);
    } else {
      if (result.promptArg !== null) {
        fatal('Only one prompt argument allowed. Use --file for file input.', result.json);
      }
      result.promptArg = arg;
    }
    i++;
  }

  return result;
}

// ─── Policy Enforcement Check ───────────────────────────────────────────────

/** Check policy gates and exit 3 if blocked. Returns violation details for JSON output. */
function checkPolicyGates(
  prompt: string,
  context: string | undefined,
  args: SubcommandArgs,
): void {
  const policyMode = getPolicyMode();
  if (policyMode !== 'enforce') return;

  const taskType = detectTaskType(prompt);
  const ruleResults = runRules(prompt, context, taskType);
  const violations = evaluatePolicyViolations(ruleResults, { policy_mode: 'enforce' });

  if (violations.length > 0) {
    if (args.json) {
      writeJson(envelope('policy_blocked', {
        status: 'blocked',
        reason: 'blocking_rule_violations',
        violations: violations.map(v => ({
          rule: v.rule_id,
          description: v.description,
        })),
      }), args);
    } else if (!args.quiet) {
      process.stderr.write(`Policy blocked: ${violations.length} BLOCKING rule violation(s) detected.\n`);
      for (const v of violations) {
        process.stderr.write(`  - ${v.description}\n`);
      }
    }
    process.exit(3);
  }

  // Risk threshold check
  const riskScore = computeRiskScore(ruleResults);
  const strictness = getStrictness();
  const riskCheck = checkRiskThreshold(riskScore.score, strictness);

  if (riskCheck.exceeded) {
    if (args.json) {
      writeJson(envelope('policy_blocked', {
        status: 'blocked',
        reason: 'risk_threshold_exceeded',
        risk_score: riskScore.score,
        threshold: riskCheck.threshold,
      }), args);
    } else if (!args.quiet) {
      process.stderr.write(`Policy blocked: risk score ${riskScore.score} exceeds threshold ${riskCheck.threshold}.\n`);
    }
    process.exit(3);
  }
}

// ─── Subcommand Handlers ────────────────────────────────────────────────────

async function handleOptimize(args: SubcommandArgs): Promise<void> {
  const prompt = await resolveInput(args);
  const context = resolveContext(args);

  // Policy gate
  checkPolicyGates(prompt, context, args);

  const result = optimize(prompt, context, args.target);

  if (args.json) {
    writeJson(envelope('optimize', {
      quality_score: result.quality.total,
      task_type: result.intent.task_type,
      risk_level: result.intent.risk_level,
      target: args.target,
      compiled_prompt: result.compiled,
      changes: result.changes,
      checklist: {
        summary: result.checklist.summary,
        items: result.checklist.items.map(it => ({
          name: it.name,
          present: it.present,
        })),
      },
      cost: {
        input_tokens: result.cost.input_tokens,
        recommended_model: result.cost.recommended_model,
        recommendation_reason: result.cost.recommendation_reason,
      },
    }), args);
  } else if (!args.quiet) {
    process.stdout.write(`${BIN_NAME} optimize v${VERSION}\n\n`);
    process.stdout.write(`PQS: ${result.quality.total}/100\n`);
    process.stdout.write(`Task Type:     ${result.intent.task_type}\n`);
    process.stdout.write(`Risk Level:    ${result.intent.risk_level}\n`);
    process.stdout.write(`Target:        ${args.target}\n`);
    process.stdout.write(`Changes:       ${result.changes.length} applied\n`);
    process.stdout.write(`Model:         ${result.cost.recommended_model}\n\n`);
    process.stdout.write(`--- Compiled Prompt ---\n${result.compiled}\n`);
  }
  process.exit(0);
}

async function handleClassify(args: SubcommandArgs): Promise<void> {
  const prompt = await resolveInput(args);
  const taskType = detectTaskType(prompt);
  const complexity = classifyComplexity(prompt);

  if (args.json) {
    writeJson(envelope('classify', {
      task_type: taskType,
      complexity: complexity.complexity,
      confidence: complexity.confidence,
      signals: complexity.signals,
    }), args);
  } else if (!args.quiet) {
    process.stdout.write(`Task Type:   ${taskType}\n`);
    process.stdout.write(`Complexity:  ${complexity.complexity}\n`);
    process.stdout.write(`Confidence:  ${complexity.confidence}%\n`);
    if (complexity.signals.length > 0) {
      process.stdout.write(`Signals:     ${complexity.signals.join(', ')}\n`);
    }
  }
  process.exit(0);
}

async function handleRoute(args: SubcommandArgs): Promise<void> {
  const prompt = await resolveInput(args);
  const context = resolveContext(args);

  // Policy gate (risk threshold)
  checkPolicyGates(prompt, context, args);

  const taskType = detectTaskType(prompt);
  const complexity = classifyComplexity(prompt);
  const ruleResults = runRules(prompt, context, taskType);
  const riskScore = computeRiskScore(ruleResults);

  const recommendation = routeModel({
    taskType,
    complexity: complexity.complexity,
    budgetSensitivity: 'medium',
    latencySensitivity: 'medium',
    contextTokens: estimateTokens(prompt + (context || '')),
    riskScore: riskScore.score,
  }, prompt, complexity.confidence, args.target);

  if (args.json) {
    writeJson(envelope('route', {
      primary: recommendation.primary,
      fallback: recommendation.fallback,
      confidence: recommendation.confidence,
      rationale: recommendation.rationale,
      savings_summary: recommendation.savings_summary,
      decision_path: recommendation.decision_path,
    }), args);
  } else if (!args.quiet) {
    process.stdout.write(`Recommended: ${recommendation.primary.model} (${recommendation.primary.provider})\n`);
    process.stdout.write(`Fallback:    ${recommendation.fallback.model} (${recommendation.fallback.provider})\n`);
    process.stdout.write(`Confidence:  ${recommendation.confidence}%\n`);
    process.stdout.write(`Savings:     ${recommendation.savings_summary}\n`);
    process.stdout.write(`Rationale:   ${recommendation.rationale}\n`);
  }
  process.exit(0);
}

async function handleCompress(args: SubcommandArgs): Promise<void> {
  // For compress, the "prompt" input is the context to compress
  const text = await resolveInput(args);
  const intent = args.intent || 'general';

  const result = compressContext(text, intent);

  if (args.json) {
    const saved = result.originalTokens - result.compressedTokens;
    const pct = result.originalTokens > 0
      ? Math.round((1 - result.compressedTokens / result.originalTokens) * 100)
      : 0;
    writeJson(envelope('compress', {
      original_tokens: result.originalTokens,
      compressed_tokens: result.compressedTokens,
      tokens_saved: saved,
      savings_percent: pct,
      heuristics_applied: result.heuristics_applied || [],
      removed_sections: result.removed,
    }), args);
  } else if (!args.quiet) {
    const saved = result.originalTokens - result.compressedTokens;
    const pct = result.originalTokens > 0
      ? Math.round((1 - result.compressedTokens / result.originalTokens) * 100)
      : 0;
    process.stdout.write(`Original:   ${result.originalTokens} tokens\n`);
    process.stdout.write(`Compressed: ${result.compressedTokens} tokens\n`);
    process.stdout.write(`Saved:      ${saved} tokens (${pct}%)\n\n`);
    process.stdout.write(result.compressed + '\n');
  }
  process.exit(0);
}

async function handleCost(args: SubcommandArgs): Promise<void> {
  const prompt = await resolveInput(args);
  const taskType = detectTaskType(prompt);
  const intentSpec = analyzePrompt(prompt);
  const cost = estimateCost(prompt, taskType, intentSpec.risk_level, args.target);

  if (args.json) {
    writeJson(envelope('cost', {
      input_tokens: cost.input_tokens,
      estimated_output_tokens: cost.estimated_output_tokens,
      recommended_model: cost.recommended_model,
      recommendation_reason: cost.recommendation_reason,
      costs: cost.costs.map(c => ({
        provider: c.provider,
        model: c.model,
        total_cost_usd: c.total_cost_usd,
      })),
    }), args);
  } else if (!args.quiet) {
    process.stdout.write(`Input tokens: ${cost.input_tokens}\n`);
    process.stdout.write(`Est. output:  ${cost.estimated_output_tokens}\n`);
    process.stdout.write(`Recommended:  ${cost.recommended_model}\n\n`);
    for (const c of cost.costs) {
      process.stdout.write(`  ${c.provider}/${c.model}: $${c.total_cost_usd.toFixed(6)}\n`);
    }
  }
  process.exit(0);
}

async function handleScore(args: SubcommandArgs): Promise<void> {
  const prompt = await resolveInput(args);
  const context = resolveContext(args);
  const intentSpec = analyzePrompt(prompt, context);
  const score = scorePrompt(intentSpec, context);

  if (args.json) {
    writeJson(envelope('score', {
      total: score.total,
      max: score.max,
      dimensions: score.dimensions,
    }), args);
  } else if (!args.quiet) {
    process.stdout.write(`PQS: ${score.total}/100\n`);
    if (score.confidence) {
      const note = score.confidence_note ? ` — ${score.confidence_note}` : '';
      process.stdout.write(`Confidence: ${score.confidence}${note}\n`);
    }
    process.stdout.write(`\n`);
    for (const dim of score.dimensions) {
      const firstNote = dim.notes?.length ? ` — ${dim.notes[0]}` : '';
      process.stdout.write(`  ${dim.name}: ${dim.score}/${dim.max}${firstNote}\n`);
    }
  }
  process.exit(0);
}

async function handlePreflight(args: SubcommandArgs): Promise<void> {
  const prompt = await resolveInput(args);
  const context = resolveContext(args);

  // Policy gate
  checkPolicyGates(prompt, context, args);

  const taskType = detectTaskType(prompt);
  const complexity = classifyComplexity(prompt);
  const intentSpec = analyzePrompt(prompt, context);
  const score = scorePrompt(intentSpec, context);
  const ruleResults = runRules(prompt, context, taskType);
  const riskScore = computeRiskScore(ruleResults);

  const recommendation = routeModel({
    taskType,
    complexity: complexity.complexity,
    budgetSensitivity: 'medium',
    latencySensitivity: 'medium',
    contextTokens: estimateTokens(prompt + (context || '')),
    riskScore: riskScore.score,
  }, prompt, complexity.confidence, args.target);

  if (args.json) {
    writeJson(envelope('preflight', {
      task_type: taskType,
      complexity: complexity.complexity,
      confidence: complexity.confidence,
      pqs: score.total,
      risk_score: riskScore.score,
      risk_level: riskScore.level,
      risk_dimensions: riskScore.dimensions,
      recommended_model: recommendation.primary.model,
      recommended_provider: recommendation.primary.provider,
      savings_summary: recommendation.savings_summary,
      decision_path: recommendation.decision_path,
    }), args);
  } else if (!args.quiet) {
    process.stdout.write(`${BIN_NAME} preflight v${VERSION}\n\n`);
    process.stdout.write(`Task:       ${taskType}\n`);
    process.stdout.write(`Complexity: ${complexity.complexity} (${complexity.confidence}% confidence)\n`);
    process.stdout.write(`PQS:        ${score.total}/100\n`);
    if (score.confidence) {
      const note = score.confidence_note ? ` — ${score.confidence_note}` : '';
      process.stdout.write(`Confidence: ${score.confidence}${note}\n`);
    }
    process.stdout.write(`Risk:       ${riskScore.score}/100 (${riskScore.level})\n`);
    process.stdout.write(`Model:      ${recommendation.primary.model} (${recommendation.primary.provider})\n`);
    process.stdout.write(`Savings:    ${recommendation.savings_summary}\n`);
  }
  process.exit(0);
}

async function handleConfig(args: SubcommandArgs): Promise<void> {
  const config = loadConfig();
  const display = {
    policy_mode: config.policy_mode || 'advisory',
    strictness: config.strictness || 'standard',
    mode: config.mode || 'manual',
    threshold: config.threshold ?? 60,
    auto_compile: config.auto_compile ?? true,
    default_target: config.default_target || 'claude',
    ephemeral_mode: config.ephemeral_mode ?? false,
    session_retention_days: config.session_retention_days ?? null,
    audit_log: config.audit_log ?? false,
    locked: config.locked_config ?? false,
    data_dir: DATA_DIR,
  };

  if (args.json) {
    writeJson(envelope('config', display), args);
  } else if (!args.quiet) {
    process.stdout.write(`${BIN_NAME} config v${VERSION}\n\n`);
    process.stdout.write(`Policy Mode:     ${display.policy_mode}\n`);
    process.stdout.write(`Strictness:      ${display.strictness}\n`);
    process.stdout.write(`Mode:            ${display.mode}\n`);
    process.stdout.write(`Threshold:       ${display.threshold}\n`);
    process.stdout.write(`Default Target:  ${display.default_target}\n`);
    process.stdout.write(`Audit Log:       ${display.audit_log}\n`);
    process.stdout.write(`Config Locked:   ${display.locked}\n`);
    process.stdout.write(`Retention Days:  ${display.session_retention_days ?? 'none'}\n`);
    process.stdout.write(`Data Directory:  ${display.data_dir}\n`);
  }
  process.exit(0);
}

async function handleDoctor(args: SubcommandArgs): Promise<void> {
  const checks: Array<{ name: string; status: 'ok' | 'warning' | 'error'; detail: string }> = [];

  // Check data directory exists
  if (existsSync(DATA_DIR)) {
    checks.push({ name: 'data_directory', status: 'ok', detail: DATA_DIR });
  } else {
    checks.push({ name: 'data_directory', status: 'warning', detail: `${DATA_DIR} does not exist (will be created on first use)` });
  }

  // Check config.json
  const configPath = join(DATA_DIR, 'config.json');
  try {
    if (existsSync(configPath)) {
      JSON.parse(readFileSync(configPath, 'utf-8'));
      checks.push({ name: 'config', status: 'ok', detail: 'Valid JSON' });
    } else {
      checks.push({ name: 'config', status: 'ok', detail: 'Not created yet (defaults will apply)' });
    }
  } catch {
    checks.push({ name: 'config', status: 'error', detail: 'config.json is corrupt or unreadable' });
  }

  // Check usage.json
  const usagePath = join(DATA_DIR, 'usage.json');
  try {
    if (existsSync(usagePath)) {
      JSON.parse(readFileSync(usagePath, 'utf-8'));
      checks.push({ name: 'usage', status: 'ok', detail: 'Valid JSON' });
    } else {
      checks.push({ name: 'usage', status: 'ok', detail: 'Not created yet' });
    }
  } catch {
    checks.push({ name: 'usage', status: 'error', detail: 'usage.json is corrupt or unreadable' });
  }

  // Check license.json
  const licensePath = join(DATA_DIR, 'license.json');
  try {
    if (existsSync(licensePath)) {
      const data = JSON.parse(readFileSync(licensePath, 'utf-8'));
      checks.push({ name: 'license', status: 'ok', detail: `Tier: ${data.tier || 'unknown'}` });
    } else {
      checks.push({ name: 'license', status: 'ok', detail: 'No license (free tier)' });
    }
  } catch {
    checks.push({ name: 'license', status: 'error', detail: 'license.json is corrupt or unreadable' });
  }

  // Check audit.log
  const auditPath = join(DATA_DIR, 'audit.log');
  if (existsSync(auditPath)) {
    try {
      const content = readFileSync(auditPath, 'utf-8').trim();
      const lines = content.split('\n').filter(l => l.trim());
      // Verify each line is valid JSON
      let valid = true;
      for (const line of lines.slice(0, 10)) { // check first 10 entries
        try { JSON.parse(line); } catch { valid = false; break; }
      }
      if (valid) {
        checks.push({ name: 'audit_log', status: 'ok', detail: `${lines.length} entries` });
      } else {
        checks.push({ name: 'audit_log', status: 'error', detail: 'Audit log contains invalid JSONL entries' });
      }
    } catch {
      checks.push({ name: 'audit_log', status: 'error', detail: 'Audit log is unreadable' });
    }
  } else {
    checks.push({ name: 'audit_log', status: 'ok', detail: 'Not enabled' });
  }

  // Check custom rules
  const customRulesPath = join(DATA_DIR, 'custom-rules.json');
  if (existsSync(customRulesPath)) {
    try {
      const data = JSON.parse(readFileSync(customRulesPath, 'utf-8'));
      const count = Array.isArray(data) ? data.length : (data.rules?.length || 0);
      checks.push({ name: 'custom_rules', status: 'ok', detail: `${count} rules loaded` });
    } catch {
      checks.push({ name: 'custom_rules', status: 'error', detail: 'custom-rules.json is corrupt' });
    }
  } else {
    checks.push({ name: 'custom_rules', status: 'ok', detail: 'None configured' });
  }

  // Check policy mode
  const config = loadConfig();
  const policyMode = config.policy_mode || 'advisory';
  const locked = config.locked_config || false;
  checks.push({ name: 'policy_mode', status: 'ok', detail: `${policyMode}${locked ? ' (config locked)' : ''}` });

  const hasErrors = checks.some(c => c.status === 'error');
  const hasWarnings = checks.some(c => c.status === 'warning');

  if (args.json) {
    writeJson(envelope('doctor', {
      healthy: !hasErrors,
      checks,
    }), args);
  } else if (!args.quiet) {
    process.stdout.write(`${BIN_NAME} doctor v${VERSION}\n\n`);
    for (const c of checks) {
      const icon = c.status === 'ok' ? '\u2713' : c.status === 'warning' ? '!' : '\u2717';
      process.stdout.write(`  ${icon} ${c.name}: ${c.detail}\n`);
    }
    process.stdout.write(`\n${hasErrors ? 'Issues found.' : hasWarnings ? 'Healthy (with warnings).' : 'All healthy.'}\n`);
  }
  process.exit(hasErrors ? 1 : 0);
}

// ─── Legacy Check Mode (backward compatible) ───────────────────────────────

async function lintPrompt(prompt: string, source: string, threshold: number): Promise<LintResult> {
  const taskType = detectTaskType(prompt);
  const intentSpec = analyzePrompt(prompt);
  const score = scorePrompt(intentSpec);
  const pass = score.total >= threshold;

  const ruleResults = runRules(prompt, undefined, taskType);
  const applicableCustomRules = await customRules.getRulesForTask(taskType);
  const customIssues: Array<{ rule: string; severity: string; message: string }> = [];
  for (const rule of applicableCustomRules) {
    const match = await customRules.evaluateRule(rule, prompt, taskType);
    if (match && match.matched) {
      customIssues.push({
        rule: match.rule_id,
        severity: match.severity === 'BLOCKING' ? 'blocking' : 'non_blocking',
        message: match.description,
      });
    }
  }

  const sorted = sortIssues(ruleResults).filter(r => r.triggered);
  const builtInIssues = sorted.slice(0, 5).map(r => ({
    rule: r.rule_name,
    severity: r.severity,
    message: r.message,
  }));
  const issues = [...builtInIssues, ...customIssues].slice(0, 5);

  return { source, score: score.total, pass, confidence: score.confidence, issues };
}

function collectFilesFromDir(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      results.push(...collectFilesFromDir(full));
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (ext === '.txt' || ext === '.md') {
        results.push(full);
      }
    }
  }
  return results;
}

async function resolveFiles(fileArgs: string[]): Promise<string[]> {
  const allFiles: string[] = [];
  for (const arg of fileArgs) {
    try {
      const stat = statSync(arg);
      if (stat.isDirectory()) { allFiles.push(...collectFilesFromDir(resolve(arg))); continue; }
      if (stat.isFile()) { allFiles.push(resolve(arg)); continue; }
    } catch {
      // Not a literal file/dir — treat as glob
    }
    const fg = await import('fast-glob');
    const matches = await fg.default(arg, { onlyFiles: true, unique: true, ignore: ['**/node_modules/**'] });
    allFiles.push(...matches.map(m => resolve(m)));
  }
  return [...new Set(allFiles)].sort((a, b) => a.localeCompare(b));
}

/** Run check (legacy lint mode) for a subcommand invocation. */
async function handleCheck(args: SubcommandArgs): Promise<void> {
  // Validate flag conflicts
  if (args.strict && args.relaxed) {
    fatal('--strict and --relaxed are mutually exclusive', args.json);
  }

  let threshold: number = THRESHOLDS.standard;
  if (args.threshold !== null) {
    threshold = args.threshold;
  } else if (args.strict) {
    threshold = THRESHOLDS.strict;
  } else if (args.relaxed) {
    threshold = THRESHOLDS.relaxed;
  }

  // Check for conflicting inputs: prompt arg + --file together is an error
  if (args.fileArgs.length > 0 && args.promptArg !== null) {
    fatal('Cannot combine --file with a prompt argument.', args.json);
  }

  const prompts: Array<{ source: string; text: string }> = [];

  if (args.fileArgs.length > 0) {
    const files = await resolveFiles(args.fileArgs);
    if (files.length === 0) {
      fatal('No files matched. Check quoting, paths, and that `actions/checkout` ran.', args.json);
    }
    for (const file of files) {
      const text = normalizeCrlf(readFileSync(file, 'utf-8')).trim();
      if (text.length === 0) fatal(`File is empty: ${file}`, args.json);
      prompts.push({ source: file, text });
    }
  } else if (args.promptArg !== null) {
    const text = normalizeCrlf(args.promptArg).trim();
    if (text.length === 0) fatal('Prompt is empty.', args.json);
    prompts.push({ source: '<argument>', text });
  } else if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) { chunks.push(chunk as Buffer); }
    const text = normalizeCrlf(Buffer.concat(chunks).toString('utf-8')).trim();
    if (text.length === 0) fatal('No prompt provided. Pass as argument, --file, or pipe via stdin.', args.json);
    prompts.push({ source: '<stdin>', text });
  } else {
    fatal('No prompt provided. Pass as argument, --file, or pipe via stdin.', args.json);
  }

  const results: LintResult[] = [];
  for (const { source, text } of prompts) {
    results.push(await lintPrompt(text, source, threshold));
  }

  const passed = results.filter(r => r.pass).length;
  const failed = results.length - passed;

  if (args.format === 'github') {
    // GitHub Actions annotation format
    for (const r of results) {
      const confidence = r.confidence ?? 'n/a';
      if (r.pass) {
        process.stdout.write(`::notice file=${r.source}::PQS ${r.score}/100 — Confidence: ${confidence}\n`);
      } else {
        process.stdout.write(`::error file=${r.source}::PQS ${r.score}/100 below threshold ${threshold} — Confidence: ${confidence}\n`);
      }
    }
  } else if (args.json) {
    process.stdout.write(JSON.stringify({
      version: VERSION,
      threshold,
      results,
      summary: { total: results.length, passed, failed },
    }, null, 2) + '\n');
  } else if (!args.quiet) {
    process.stdout.write(`${BIN_NAME} v${VERSION}\n\n`);
    for (const r of results) {
      const icon = r.pass ? '\u2713' : '\u2717';
      const status = r.pass ? 'PASS' : 'FAIL';
      process.stdout.write(`${icon} ${r.source}    PQS: ${r.score}/100  ${status} (threshold: ${threshold})\n`);
      if (r.confidence) {
        process.stdout.write(`  Confidence: ${r.confidence}\n`);
      }
      if (!r.pass && r.issues.length > 0) {
        for (const issue of r.issues) {
          process.stdout.write(`  \u2192 ${issue.rule}: ${issue.message}\n`);
        }
      }
    }
    process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  }

  if (args.warnOnly) process.exit(0);
  process.exit(failed > 0 ? 1 : 0);
}

// ─── Hook Management ────────────────────────────────────────────────────────

const HOOK_ACTIONS = new Set(['install', 'uninstall', 'status']);
const HOOK_SCRIPT_NAME = 'pcp-preflight.mjs';

function getHookDir(isGlobal: boolean): string {
  const base = isGlobal
    ? join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.claude')
    : join(process.cwd(), '.claude');
  return join(base, 'hooks');
}

function getSettingsPath(isGlobal: boolean): string {
  const base = isGlobal
    ? join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.claude')
    : join(process.cwd(), '.claude');
  return join(base, 'settings.json');
}

function generateHookScript(threshold: number): string {
  const lines = [
    '#!/usr/bin/env node',
    '// PCP Quality Gate — auto-checks prompts before they reach the LLM',
    '// Installed by: pcp hook install | Threshold: ' + threshold + '/100',
    '// Works with any MCP client that supports UserPromptSubmit hooks.',
    '',
    'import { execFileSync } from "node:child_process";',
    '',
    'let input = "";',
    'process.stdin.on("data", chunk => { input += chunk; });',
    'process.stdin.on("end", () => {',
    '  try {',
    '    const data = JSON.parse(input);',
    '    const prompt = data.prompt || "";',
    '    if (prompt.length < 20) process.exit(0);',
    '',
    '    const result = execFileSync("pcp", ["check", "--json", prompt], {',
    '      encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"],',
    '    });',
    '    const parsed = JSON.parse(result);',
    '    const score = parsed.score || 0;',
    '    const pass = parsed.pass !== false;',
    '',
    '    if (!pass || score < ' + threshold + ') {',
    '      const issues = (parsed.issues || []).slice(0, 2).map(i => i.message).join("; ");',
    '      const msg = "PCP Quality Gate: " + score + "/100. " + issues;',
    '      process.stdout.write(JSON.stringify({',
    '        hookSpecificOutput: {',
    '          hookEventName: "UserPromptSubmit",',
    '          additionalContext: msg,',
    '        },',
    '      }));',
    '    }',
    '  } catch {',
    '    // Silent fail — never block the user',
    '  }',
    '  process.exit(0);',
    '});',
    '',
  ];
  return lines.join('\n');
}

function buildHookEntry(scriptPath: string): Record<string, unknown> {
  return {
    matcher: '',
    hooks: [{ type: 'command', command: 'node ' + scriptPath }],
  };
}

function isPcpHook(entry: Record<string, unknown>): boolean {
  const inner = entry.hooks as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(inner)) return false;
  return inner.some(h => typeof h.command === 'string' && h.command.includes(HOOK_SCRIPT_NAME));
}

async function handleHookCommand(rawArgs: string[]): Promise<void> {
  const isGlobal = rawArgs.includes('--global');
  const isJson = rawArgs.includes('--json');
  const isQuiet = rawArgs.includes('--quiet') || rawArgs.includes('-q');
  const isPretty = rawArgs.includes('--pretty');
  const isHelp = rawArgs.includes('--help') || rawArgs.includes('-h');

  const action = rawArgs.find(a => HOOK_ACTIONS.has(a));

  // Parse threshold
  let thresholdOverride: number | null = null;
  const thIdx = rawArgs.indexOf('--threshold');
  if (thIdx >= 0 && thIdx + 1 < rawArgs.length) {
    const val = Number(rawArgs[thIdx + 1]);
    if (Number.isInteger(val) && val >= 0 && val <= 100) thresholdOverride = val;
  }

  const fmtArgs = { pretty: isPretty };

  if (!action || isHelp) {
    const helpLines = [
      BIN_NAME + ' hook — Manage auto-check hooks for MCP clients',
      '',
      'Usage:',
      '  ' + BIN_NAME + ' hook install [--global] [--threshold <n>]',
      '  ' + BIN_NAME + ' hook uninstall [--global]',
      '  ' + BIN_NAME + ' hook status [--global]',
      '',
      'Actions:',
      '  install     Install UserPromptSubmit hook (auto-checks every prompt)',
      '  uninstall   Remove hook and clean up',
      '  status      Check if hook is configured',
      '',
      'Options:',
      '  --global      Install to ~/.claude/ (all projects) instead of ./.claude/ (this project)',
      '  --threshold   Quality threshold 0-100 (default: from config strictness)',
      '  --json        JSON output',
      '',
      'Works with any MCP client that supports UserPromptSubmit hooks (Claude Code, Cursor, Windsurf).',
      '',
    ];
    process.stdout.write(helpLines.join('\n'));
    process.exit(0);
  }

  const hookDir = getHookDir(isGlobal);
  const settingsPath = getSettingsPath(isGlobal);
  const scriptPath = join(hookDir, HOOK_SCRIPT_NAME);
  const relativeScriptPath = isGlobal ? scriptPath : '.claude/hooks/' + HOOK_SCRIPT_NAME;

  switch (action) {
    case 'install': {
      // Determine threshold from config or override
      const strictness = getStrictness() as keyof typeof THRESHOLDS;
      const threshold = thresholdOverride ?? THRESHOLDS[strictness] ?? THRESHOLDS.standard;

      // Create hooks directory + write script
      mkdirSync(hookDir, { recursive: true });
      writeFileSync(scriptPath, generateHookScript(threshold), 'utf-8');
      try { chmodSync(scriptPath, 0o755); } catch { /* Windows */ }

      // Read or create settings.json (no TOCTOU: try read directly, catch ENOENT)
      let settings: Record<string, unknown> = {};
      try {
        settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      } catch (err: unknown) {
        // File doesn't exist or is invalid JSON — start fresh
        if (err && typeof err === 'object' && 'code' in err && (err as {code: string}).code !== 'ENOENT') {
          // JSON parse error on existing file — still start fresh but that's expected
        }
      }

      // Merge hook — remove old PCP entries first, then add
      if (!settings.hooks) settings.hooks = {};
      const hooks = settings.hooks as Record<string, unknown>;
      if (Array.isArray(hooks.UserPromptSubmit)) {
        hooks.UserPromptSubmit = (hooks.UserPromptSubmit as Array<Record<string, unknown>>)
          .filter(h => !isPcpHook(h));
      }
      if (!Array.isArray(hooks.UserPromptSubmit)) hooks.UserPromptSubmit = [];
      (hooks.UserPromptSubmit as unknown[]).push(buildHookEntry(relativeScriptPath));

      // Atomic write: write to temp file then rename to avoid partial writes
      mkdirSync(dirname(settingsPath), { recursive: true });
      const tmpSettingsPath = settingsPath + '.tmp.' + process.pid;
      writeFileSync(tmpSettingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
      renameSync(tmpSettingsPath, settingsPath);

      if (isJson) {
        writeJson(envelope('hook', {
          action: 'install', status: 'installed',
          scope: isGlobal ? 'global' : 'project',
          threshold, hook_script: scriptPath, settings_file: settingsPath,
        }), fmtArgs);
      } else if (!isQuiet) {
        const scope = isGlobal ? 'globally' : 'for this project';
        process.stdout.write('PCP hook installed ' + scope + '.\n');
        process.stdout.write('  Hook script: ' + scriptPath + '\n');
        process.stdout.write('  Settings:    ' + settingsPath + '\n');
        process.stdout.write('  Threshold:   ' + threshold + '/100\n\n');
        process.stdout.write('Every prompt will be auto-checked before it reaches the LLM.\n');
      }
      process.exit(0);
    }

    case 'uninstall': {
      let removed = false;

      // Remove hook script (no TOCTOU: just try unlink, catch ENOENT)
      try {
        unlinkSync(scriptPath);
        removed = true;
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && (err as {code: string}).code !== 'ENOENT') throw err;
      }

      // Remove from settings.json (no TOCTOU: try read directly, catch ENOENT)
      try {
        const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
        const hooks = settings.hooks as Record<string, unknown> | undefined;
        if (hooks && Array.isArray(hooks.UserPromptSubmit)) {
          hooks.UserPromptSubmit = (hooks.UserPromptSubmit as Array<Record<string, unknown>>)
            .filter(h => !isPcpHook(h));
          if ((hooks.UserPromptSubmit as unknown[]).length === 0) delete hooks.UserPromptSubmit;
          if (Object.keys(hooks).length === 0) delete settings.hooks;
          const tmpPath = settingsPath + '.tmp.' + process.pid;
          writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
          renameSync(tmpPath, settingsPath);
          removed = true;
        }
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && (err as {code: string}).code !== 'ENOENT') { /* ignore other errors */ }
      }

      if (isJson) {
        writeJson(envelope('hook', {
          action: 'uninstall', status: removed ? 'removed' : 'not_found',
          scope: isGlobal ? 'global' : 'project',
        }), fmtArgs);
      } else if (!isQuiet) {
        process.stdout.write(removed ? 'PCP hook removed.\\n' : 'PCP hook was not installed.\\n');
      }
      process.exit(0);
    }

    case 'status': {
      const hookScriptExists = existsSync(scriptPath);
      let settingsConfigured = false;
      if (existsSync(settingsPath)) {
        try {
          const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
          const hooks = settings.hooks as Record<string, unknown> | undefined;
          if (hooks && Array.isArray(hooks.UserPromptSubmit)) {
            settingsConfigured = (hooks.UserPromptSubmit as Array<Record<string, unknown>>).some(isPcpHook);
          }
        } catch { /* ignore */ }
      }

      const installed = hookScriptExists && settingsConfigured;

      if (isJson) {
        writeJson(envelope('hook', {
          action: 'status', installed,
          scope: isGlobal ? 'global' : 'project',
          hook_script_exists: hookScriptExists,
          settings_configured: settingsConfigured,
        }), fmtArgs);
      } else if (!isQuiet) {
        if (installed) {
          process.stdout.write('PCP hook is installed (' + (isGlobal ? 'global' : 'project') + ').\n');
          process.stdout.write('  Hook script: ' + scriptPath + '\n');
          process.stdout.write('  Settings:    ' + settingsPath + '\n');
        } else if (hookScriptExists && !settingsConfigured) {
          process.stdout.write('PCP hook script exists but is not configured in settings.\nRun \'pcp hook install\' to fix.\n');
        } else if (!hookScriptExists && settingsConfigured) {
          process.stdout.write('PCP hook is configured but script is missing.\nRun \'pcp hook install\' to fix.\n');
        } else {
          process.stdout.write('PCP hook is not installed.\nRun \'pcp hook install\' to set up auto-checking.\n');
        }
      }
      process.exit(0);
    }
  }
}

// ─── Validate Custom Rules Mode ─────────────────────────────────────────────

async function handleValidateCustomRules(): Promise<void> {
  const rules = await customRules.loadRules();
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const rule of rules) {
    const validation = customRules.validateRule(rule);
    if (!validation.valid) {
      errors.push(...validation.errors.map(e => `Rule "${rule.id}": ${e}`));
    }
  }

  for (const rule of rules) {
    try { new RegExp(rule.pattern); } catch (err) {
      warnings.push(`Rule "${rule.id}": pattern failed to compile: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (rule.negative_pattern) {
      try { new RegExp(rule.negative_pattern); } catch (err) {
        warnings.push(`Rule "${rule.id}": negative_pattern failed to compile: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  process.stdout.write(JSON.stringify({
    valid: errors.length === 0,
    rule_count: rules.length,
    validation_errors: errors,
    validation_warnings: warnings,
    storage_path: join(DATA_DIR, 'custom-rules.json'),
  }, null, 2) + '\n');
  process.exit(errors.length === 0 ? 0 : 1);
}

// ─── Demo Mode ──────────────────────────────────────────────────────────────

async function handleDemo(): Promise<void> {
  const demos = [
    { label: 'Vague', prompt: 'make the code better' },
    {
      label: 'Well-specified',
      prompt: 'Refactor the authentication middleware in src/auth/middleware.ts to use JWT tokens instead of session cookies. Do not modify the user model or database layer. Must pass all existing tests.',
    },
  ];

  process.stdout.write('\n\u2500\u2500 PCP Demo \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\n');

  for (const { label, prompt } of demos) {
    const intentSpec = analyzePrompt(prompt);
    const score = scorePrompt(intentSpec);
    const truncated = prompt.length > 60 ? prompt.slice(0, 57) + '...' : prompt;

    // Find the top dimension issue (lowest-scoring dimension)
    let topIssue = '';
    if (score.dimensions.length > 0) {
      const worst = score.dimensions.reduce((a, b) =>
        (a.score / a.max) < (b.score / b.max) ? a : b,
      );
      const firstNote = worst.notes?.length ? worst.notes[0] : 'needs improvement';
      topIssue = `${worst.name}: ${firstNote}`;
    }

    process.stdout.write(`  ${label}: "${truncated}"\n`);
    process.stdout.write(`    PQS: ${score.total}/100`);
    if (score.confidence) {
      process.stdout.write(`  Confidence: ${score.confidence}`);
    }
    process.stdout.write('\n');
    if (topIssue) {
      process.stdout.write(`    Top issue: ${topIssue}\n`);
    }
    process.stdout.write('\n');
  }

  process.stdout.write('\u2500\u2500 Try it yourself \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n');
  process.stdout.write('  pcp score "your prompt here"\n');
  process.stdout.write('  pcp check "your prompt here"\n');
  process.stdout.write('  pcp preflight "your prompt here" --json\n');

  process.exit(0);
}

// ─── Report Generation ──────────────────────────────────────────────────────

async function handleReport(args: SubcommandArgs): Promise<void> {
  const prompt = await resolveInput(args);
  const context = resolveContext(args);

  // Full analysis
  const taskType = detectTaskType(prompt);
  const complexity = classifyComplexity(prompt);
  const intentSpec = analyzePrompt(prompt, context);
  const score = scorePrompt(intentSpec, context);
  const ruleResults = runRules(prompt, context, taskType);
  const riskScore = computeRiskScore(ruleResults);

  const recommendation = routeModel({
    taskType,
    complexity: complexity.complexity,
    budgetSensitivity: 'medium',
    latencySensitivity: 'medium',
    contextTokens: estimateTokens(prompt + (context || '')),
    riskScore: riskScore.score,
  }, prompt, complexity.confidence, args.target);

  const costEstimate = estimateCost(prompt, taskType, riskScore.level, args.target);
  const sortedRules = sortIssues(ruleResults).filter(r => r.triggered);

  // Determine prompt source
  const promptSource = args.fileArg ? `file:${args.fileArg}` : 'inline';

  // Build issues list
  const issues = sortedRules.slice(0, 10).map(r => ({
    rule: r.rule_name,
    severity: r.severity,
    message: r.message,
  }));

  // Build JSON report
  const jsonReport = {
    schema_version: '1.0.0',
    generated_at: new Date().toISOString(),
    pcp_version: VERSION,
    prompt_source: promptSource,
    pqs: {
      total: score.total,
      max: score.max,
      confidence: score.confidence || 'n/a',
      confidence_note: score.confidence_note || '',
    },
    dimensions: score.dimensions.map(d => ({
      name: d.name,
      score: d.score,
      max: d.max,
      notes: d.notes || [],
    })),
    task_type: taskType,
    risk: {
      score: riskScore.score,
      level: riskScore.level,
    },
    issues,
    model_recommendation: {
      model: recommendation.primary.model,
      reason: recommendation.decision_path || '',
    },
  };

  // Build markdown report
  const dimRows = score.dimensions.map(d => {
    const firstNote = d.notes?.length ? d.notes[0] : '';
    return `| ${d.name} | ${d.score}/${d.max} | ${firstNote} |`;
  }).join('\n');

  const issueLines = issues.length > 0
    ? issues.map(iss => {
        const icon = iss.severity === 'blocking' ? '\u26d4' : '\u26a0\ufe0f';
        return `- ${icon} ${iss.message}`;
      }).join('\n')
    : '- No issues detected';

  const mdReport = `# Prompt Quality Report

**PQS: ${score.total}/100** | Confidence: ${score.confidence || 'n/a'} | Task: ${taskType} | Risk: ${riskScore.level}

## Dimensions
| Dimension | Score | Notes |
|-----------|-------|-------|
${dimRows}

## Issues Found
${issueLines}

## Recommendation
Model: ${recommendation.primary.model} | Estimated cost: $${(costEstimate.costs.find(c => c.model === costEstimate.recommended_model)?.total_cost_usd ?? costEstimate.costs[0]?.total_cost_usd ?? 0).toFixed(4)}

---
*Generated by [PCP Engine](https://github.com/rishi-banerjee1/prompt-control-plane) v${VERSION}*
`;

  // Determine output directory
  const outDir = args.outputDir ? resolve(args.outputDir) : process.cwd();
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const jsonPath = join(outDir, 'prompt-quality.json');
  const mdPath = join(outDir, 'prompt-quality.md');

  writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2) + '\n', 'utf-8');
  writeFileSync(mdPath, mdReport, 'utf-8');

  if (args.json) {
    writeJson(envelope('report', {
      json_path: jsonPath,
      md_path: mdPath,
      ...jsonReport,
    }), args);
  } else if (!args.quiet) {
    process.stdout.write(`${BIN_NAME} report v${VERSION}\n\n`);
    process.stdout.write(`PQS:    ${score.total}/100 (${score.confidence || 'n/a'})\n`);
    process.stdout.write(`Task:   ${taskType}\n`);
    process.stdout.write(`Risk:   ${riskScore.score}/100 (${riskScore.level})\n`);
    process.stdout.write(`Model:  ${recommendation.primary.model}\n\n`);
    process.stdout.write(`Written:\n  ${jsonPath}\n  ${mdPath}\n`);
  }

  process.exit(0);
}

// ─── Badge Generation ────────────────────────────────────────────────────────

async function handleBadge(args: SubcommandArgs): Promise<void> {
  const prompt = await resolveInput(args);
  const context = resolveContext(args);
  const intentSpec = analyzePrompt(prompt, context);
  const score = scorePrompt(intentSpec, context);

  const color = score.total >= 80 ? 'brightgreen' : score.total >= 60 ? 'green' : score.total >= 40 ? 'yellow' : 'red';
  const badge = `![PQS](https://img.shields.io/badge/PQS-${score.total}-${color})`;

  if (args.json) {
    writeJson(envelope('badge', {
      total: score.total,
      confidence: score.confidence,
      badge_markdown: badge,
      badge_url: `https://img.shields.io/badge/PQS-${score.total}-${color}`,
    }), args);
  } else {
    process.stdout.write(`${badge}\n`);
    if (!args.quiet) {
      process.stdout.write(`\nPaste this in your README to show your prompt quality score.\n`);
    }
  }
  process.exit(0);
}

// ─── Benchmark ──────────────────────────────────────────────────────────────

interface BenchmarkPrompt {
  id: string;
  category: string;
  difficulty: string;
  prompt: string;
  description: string;
  expected_score: number;
  expected_risk_level: string;
  expected_task_type: string;
}

interface BenchmarkData {
  schema_version: number;
  benchmark_version: string;
  created_at: string;
  score_tolerance: number;
  prompts: BenchmarkPrompt[];
}

async function handleBenchmark(args: SubcommandArgs): Promise<void> {
  const benchmarkPath = resolve(__lint_dirname, '..', '..', 'benchmarks', 'prompts.json');
  let data: BenchmarkData;
  try {
    data = JSON.parse(readFileSync(benchmarkPath, 'utf-8'));
  } catch {
    fatal('Benchmark file not found: ' + benchmarkPath, args.json);
    return;
  }

  const tolerance = data.score_tolerance || 3;
  const results: Array<{
    id: string;
    category: string;
    expected_score: number;
    actual_score: number;
    score_pass: boolean;
    expected_risk_level: string;
    actual_risk_level: string;
    risk_pass: boolean;
    expected_task_type: string;
    actual_task_type: string;
    type_pass: boolean;
  }> = [];

  let regressions = 0;

  for (const p of data.prompts) {
    const intent = analyzePrompt(p.prompt);
    const quality = scorePrompt(intent);
    const taskType = detectTaskType(p.prompt);

    const scoreDiff = Math.abs(quality.total - p.expected_score);
    const scorePass = scoreDiff <= tolerance;
    const riskPass = intent.risk_level === p.expected_risk_level;
    const typePass = taskType === p.expected_task_type;

    if (!scorePass || !riskPass || !typePass) regressions++;

    results.push({
      id: p.id,
      category: p.category,
      expected_score: p.expected_score,
      actual_score: quality.total,
      score_pass: scorePass,
      expected_risk_level: p.expected_risk_level,
      actual_risk_level: intent.risk_level,
      risk_pass: riskPass,
      expected_task_type: p.expected_task_type,
      actual_task_type: taskType,
      type_pass: typePass,
    });
  }

  const passed = results.filter(r => r.score_pass && r.risk_pass && r.type_pass).length;
  const excellent = results.filter(r => r.actual_score >= 65).length;
  const good = results.filter(r => r.actual_score >= 50 && r.actual_score < 65).length;
  const poor = results.filter(r => r.actual_score < 50).length;

  if (args.json) {
    writeJson(envelope('benchmark', {
      benchmark_version: data.benchmark_version,
      total: results.length,
      passed,
      regressions,
      tolerance,
      results,
      distribution: { excellent, good, poor },
    }), args);
  } else {
    process.stdout.write(`\nPCP Benchmark v${data.benchmark_version} (tolerance: ±${tolerance})\n`);
    process.stdout.write('─'.repeat(72) + '\n');
    process.stdout.write(
      padRight('ID', 12) + padRight('Category', 14) + padRight('Expected', 10) +
      padRight('Actual', 10) + padRight('Score', 8) + padRight('Risk', 8) + 'Type\n',
    );
    process.stdout.write('─'.repeat(72) + '\n');
    for (const r of results) {
      const scoreIcon = r.score_pass ? 'OK' : 'FAIL';
      const riskIcon = r.risk_pass ? 'OK' : 'FAIL';
      const typeIcon = r.type_pass ? 'OK' : 'FAIL';
      process.stdout.write(
        padRight(r.id, 12) + padRight(r.category, 14) +
        padRight(String(r.expected_score), 10) + padRight(String(r.actual_score), 10) +
        padRight(scoreIcon, 8) + padRight(riskIcon, 8) + typeIcon + '\n',
      );
    }
    process.stdout.write('─'.repeat(72) + '\n');
    process.stdout.write(`\nResults: ${passed}/${results.length} passed, ${regressions} regressions\n`);
    process.stdout.write(`Distribution: ${excellent} excellent, ${good} good, ${poor} poor\n\n`);
  }

  process.exit(regressions > 0 ? 1 : 0);
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

// ─── Help Text ──────────────────────────────────────────────────────────────

const HELP = `pcp-engine v${VERSION} — Prompt Quality Engine

Usage:
  ${BIN_NAME} <command> [options] "prompt"
  ${BIN_NAME} <command> --file prompt.txt
  echo "prompt" | ${BIN_NAME} <command>

Commands:
  check       Quick pass/fail quality gate (default)
  score       Detailed 5-dimension PQS breakdown
  optimize    Compile, score, and estimate cost
  preflight   Full analysis: classify + risk + route + score

  demo        Guided first-run experience

Advanced:
  classify    Detect task type and reasoning complexity
  route       Get model recommendation
  compress    Compress context
  cost        Multi-provider cost estimation
  config      Show governance configuration
  doctor      Validate environment health
  hook        Manage auto-check hooks
  report      Generate quality report (.md + .json)
  badge       Generate PQS badge markdown
  benchmark   Run scoring benchmark suite

Options:
  --json                 Structured JSON output with request_id envelope
  --quiet, -q            Suppress non-essential output
  --pretty               Pretty-print JSON output
  --target <format>      claude | openai | generic (default: claude)
  --context "text"       Additional context for the prompt
  --context-file <path>  Read context from a file
  --file, -f <path>      Read prompt from a file (or glob for check)
  --intent "text"        Intent description (for compress)
  --threshold <n>        Minimum quality score 0-100 (for check)
  --strict               Set threshold to 75 (for check)
  --relaxed              Set threshold to 40 (for check)
  --format <fmt>         Output format: human (default), json, github
  --warn-only            Exit 0 even on threshold failures (advisory CI mode)
  --output <dir>         Output directory for report files (for report)
  --validate-custom-rules  Validate custom-rules.json and exit
  --help, -h             Show this help
  --version, -v          Show version

Backward Compatible:
  prompt-lint "text"     Same as: ${BIN_NAME} check "text"
  ${BIN_NAME} "text"             Same as: ${BIN_NAME} check "text"

Exit codes:
  0  Success / all prompts pass
  1  Threshold failure (check) or health issues (doctor)
  2  Invalid arguments, no input, or no files matched
  3  Policy blocked (enforce mode)

Environment:
  PCP_DATA_DIR           Override config directory (default: ~/.prompt-control-plane/)
`;

// ─── Subcommand Router ──────────────────────────────────────────────────────

async function handleSubcommand(subcmd: string, subArgs: string[]): Promise<void> {
  // Hook has its own arg parsing (sub-actions: install/uninstall/status)
  if (subcmd === 'hook') return handleHookCommand(subArgs);

  // Demo has no args to parse
  if (subcmd === 'demo') return handleDemo();

  const args = parseSubcommandArgs(subArgs);

  if (args.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  switch (subcmd) {
    case 'optimize': return handleOptimize(args);
    case 'classify': return handleClassify(args);
    case 'route': return handleRoute(args);
    case 'compress': return handleCompress(args);
    case 'cost': return handleCost(args);
    case 'check': return handleCheck(args);
    case 'score': return handleScore(args);
    case 'preflight': return handlePreflight(args);
    case 'config': return handleConfig(args);
    case 'doctor': return handleDoctor(args);
    case 'report': return handleReport(args);
    case 'badge': return handleBadge(args);
    case 'benchmark': return handleBenchmark(args);
    default: fatal(`Unknown command: ${subcmd}`, args.json);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  // --help and --version at top level (only if no subcommand precedes them)
  const firstArg0 = rawArgs[0];
  const hasSubcommand = firstArg0 != null && SUBCOMMANDS.has(firstArg0);
  if (!hasSubcommand && (rawArgs.includes('--help') || rawArgs.includes('-h'))) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (rawArgs.includes('--version') || rawArgs.includes('-v')) {
    process.stdout.write(`${BIN_NAME} v${VERSION}\n`);
    process.exit(0);
  }

  // --validate-custom-rules (standalone)
  if (rawArgs.includes('--validate-custom-rules')) {
    return handleValidateCustomRules();
  }

  // Detect subcommand (firstArg0 already set above)
  if (hasSubcommand && firstArg0) {
    return handleSubcommand(firstArg0, rawArgs.slice(1));
  }

  // Bare `pcp` with no args and no stdin → show help + suggest demo
  if (rawArgs.length === 0 && process.stdin.isTTY) {
    process.stdout.write(HELP);
    process.stdout.write('\nGet started: pcp demo\n');
    process.exit(0);
  }

  // Legacy path: no subcommand → treat as "check"
  const args = parseSubcommandArgs(rawArgs);
  return handleCheck(args);
}

main().catch((err: unknown) => {
  const jsonMode = process.argv.includes('--json');
  const message = err instanceof Error ? err.message : String(err);
  fatal(`Unexpected error: ${message}`, jsonMode);
});
