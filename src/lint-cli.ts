// src/lint-cli.ts — Prompt Control Plane CLI (v5.0.0).
// Full subcommand suite: optimize, classify, route, compress, cost, check, score, preflight, config, doctor.
// Reuses pure API functions from api.ts. No MCP server, no sessions.
// CLI reads governance config (written by Enterprise Console) — never writes it.

import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
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
  'check', 'score', 'preflight', 'config', 'doctor',
]);

// ─── Types ──────────────────────────────────────────────────────────────────

interface LintResult {
  source: string;
  score: number;
  pass: boolean;
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
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fatal(message: string, jsonMode: boolean, exitCode: number = 2): never {
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ error: { code: exitCode, message } }, null, 2) + '\n');
  } else {
    process.stderr.write(`Error: ${message}\n`);
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
    process.stdout.write(`Quality Score: ${result.quality.total}/100\n`);
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
    process.stdout.write(`Total: ${score.total}/100\n\n`);
    for (const [name, value] of Object.entries(score.dimensions)) {
      process.stdout.write(`  ${name}: ${value}/20\n`);
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
      quality_score: score.total,
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
    process.stdout.write(`Quality:    ${score.total}/100\n`);
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

  return { source, score: score.total, pass, issues };
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

  if (args.json) {
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
      process.stdout.write(`${icon} ${r.source}    score: ${r.score}/100  ${status} (threshold: ${threshold})\n`);
      if (!r.pass && r.issues.length > 0) {
        for (const issue of r.issues) {
          process.stdout.write(`  \u2192 ${issue.rule}: ${issue.message}\n`);
        }
      }
    }
    process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  }

  process.exit(failed > 0 ? 1 : 0);
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

// ─── Help Text ──────────────────────────────────────────────────────────────

const HELP = `${BIN_NAME} v${VERSION} — Prompt Control Plane CLI

Usage:
  ${BIN_NAME} <command> [options] "prompt"
  ${BIN_NAME} <command> --file prompt.txt
  echo "prompt" | ${BIN_NAME} <command>

Commands:
  preflight   Full analysis: classify + risk + route + score (recommended)
  optimize    Compile, score, and estimate cost
  classify    Detect task type and reasoning complexity
  route       Get model recommendation with decision path
  compress    Compress context with heuristic pipeline
  cost        Multi-provider cost estimation
  score       Detailed 5-dimension quality breakdown
  check       Quick pass/fail quality gate (default if no command)
  config      Show current governance configuration (read-only)
  doctor      Validate environment health

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
    default: fatal(`Unknown command: ${subcmd}`, args.json);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  // --help and --version at top level
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
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

  // Detect subcommand
  const firstArg = rawArgs[0];
  if (firstArg && SUBCOMMANDS.has(firstArg)) {
    return handleSubcommand(firstArg, rawArgs.slice(1));
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
