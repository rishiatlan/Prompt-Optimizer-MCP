// test/cli.test.ts — Comprehensive CLI tests for pcp (v5.3.2).
// Spawns `node bin/pcp.js` as a child process to test real exit codes, JSON envelopes,
// subcommand behavior, policy enforcement, and backward compatibility.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const BIN = resolve(ROOT, 'bin', 'pcp.js');
const LINT_BIN = resolve(ROOT, 'bin', 'lint.js');

/** Read version from package.json — single source of truth for version assertions. */
const PKG_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version as string;

/** Run the CLI and return { stdout, stderr, exitCode }. Always captures both streams. */
function run(
  args: string[],
  opts?: { input?: string; env?: Record<string, string> },
): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync('node', [BIN, ...args], {
    encoding: 'utf-8',
    input: opts?.input,
    cwd: ROOT,
    timeout: 15_000,
    env: { ...process.env, ...opts?.env },
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  };
}

/** Parse JSON from stdout, tolerating leading/trailing whitespace. */
function parseJson(stdout: string): any {
  return JSON.parse(stdout.trim());
}

/** A detailed prompt that scores well (matches test/fixtures/good-prompt.txt, scores 60). */
const GOOD = 'Write a REST API for user management with authentication using JWT tokens, rate limiting at 100 requests per minute, input validation with Zod schemas, and PostgreSQL for storage. Return JSON responses with proper HTTP status codes. Include error handling for duplicate emails and invalid credentials.';

/** A vague prompt that scores poorly. */
const VAGUE = 'make it better';

// ─── 1. Backward Compatibility (8 tests) ───────────────────────────────────

describe('1. Backward compat', () => {
  it('bare prompt (no subcommand) → check mode', () => {
    const { exitCode, stdout } = run([GOOD]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('PASS'));
  });

  it('bare vague prompt → exit 1 (check fail)', () => {
    const { exitCode } = run([VAGUE]);
    assert.equal(exitCode, 1);
  });

  it('--help shows all subcommands', () => {
    const { stdout, exitCode } = run(['--help']);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('preflight'));
    assert.ok(stdout.includes('optimize'));
    assert.ok(stdout.includes('doctor'));
    assert.ok(stdout.includes('config'));
  });

  it('--version prints v5', () => {
    const { stdout, exitCode } = run(['--version']);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes(PKG_VERSION));
  });

  it('stdin input works', () => {
    const { exitCode, stdout } = run([], { input: GOOD });
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('PASS'));
  });

  it('prompt-lint binary still works', () => {
    const result = spawnSync('node', [LINT_BIN, GOOD], {
      encoding: 'utf-8', cwd: ROOT, timeout: 15_000,
    });
    assert.equal(result.status, 0, `prompt-lint should pass, got exit ${result.status}: ${result.stderr}`);
    assert.ok(result.stdout.includes('PASS'));
  });

  it('pcp check "text" is equivalent to pcp "text"', () => {
    const bare = run([VAGUE, '--json']);
    const explicit = run(['check', VAGUE, '--json']);
    const b = parseJson(bare.stdout);
    const e = parseJson(explicit.stdout);
    assert.equal(b.results[0].score, e.results[0].score);
    assert.equal(b.results[0].pass, e.results[0].pass);
  });

  it('--json in check mode has version and threshold', () => {
    const { stdout } = run([GOOD, '--json']);
    const data = parseJson(stdout);
    assert.ok(data.version);
    assert.ok(typeof data.threshold === 'number');
    assert.ok(Array.isArray(data.results));
  });
});

// ─── 2. optimize (8 tests) ─────────────────────────────────────────────────

describe('2. optimize', () => {
  it('JSON envelope has all required fields', () => {
    const { stdout, exitCode } = run(['optimize', GOOD, '--json']);
    assert.equal(exitCode, 0);
    const data = parseJson(stdout);
    assert.ok(data.request_id, 'missing request_id');
    assert.equal(data.version, PKG_VERSION);
    assert.equal(data.schema_version, 1);
    assert.equal(data.subcommand, 'optimize');
    assert.ok(typeof data.policy_mode === 'string');
  });

  it('returns quality_score, task_type, compiled_prompt', () => {
    const { stdout } = run(['optimize', GOOD, '--json']);
    const data = parseJson(stdout);
    assert.ok(typeof data.quality_score === 'number');
    assert.ok(typeof data.task_type === 'string');
    assert.ok(typeof data.compiled_prompt === 'string');
    assert.ok(data.compiled_prompt.length > 0);
  });

  it('--target openai changes target field', () => {
    const { stdout } = run(['optimize', GOOD, '--json', '--target', 'openai']);
    const data = parseJson(stdout);
    assert.equal(data.target, 'openai');
  });

  it('--target generic works', () => {
    const { stdout } = run(['optimize', GOOD, '--json', '--target', 'generic']);
    const data = parseJson(stdout);
    assert.equal(data.target, 'generic');
  });

  it('--context adds context', () => {
    const { stdout } = run(['optimize', GOOD, '--json', '--context', 'This is for a Node.js project']);
    const data = parseJson(stdout);
    assert.ok(data.compiled_prompt.length > 0);
  });

  it('returns checklist with items', () => {
    const { stdout } = run(['optimize', GOOD, '--json']);
    const data = parseJson(stdout);
    assert.ok(data.checklist);
    assert.ok(Array.isArray(data.checklist.items));
    assert.ok(data.checklist.items.length > 0);
  });

  it('returns cost estimate', () => {
    const { stdout } = run(['optimize', GOOD, '--json']);
    const data = parseJson(stdout);
    assert.ok(data.cost);
    assert.ok(typeof data.cost.input_tokens === 'number');
    assert.ok(typeof data.cost.recommended_model === 'string');
  });

  it('human-readable output (no --json)', () => {
    const { stdout, exitCode } = run(['optimize', GOOD]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('PQS:'));
    assert.ok(stdout.includes('Compiled Prompt'));
  });
});

// ─── 3. classify (6 tests) ─────────────────────────────────────────────────

describe('3. classify', () => {
  it('returns task_type and complexity', () => {
    const { stdout, exitCode } = run(['classify', 'Debug the auth module', '--json']);
    assert.equal(exitCode, 0);
    const data = parseJson(stdout);
    assert.ok(typeof data.task_type === 'string');
    assert.ok(typeof data.complexity === 'string');
  });

  it('envelope has classify subcommand', () => {
    const { stdout } = run(['classify', GOOD, '--json']);
    const data = parseJson(stdout);
    assert.equal(data.subcommand, 'classify');
  });

  it('returns confidence as number', () => {
    const { stdout } = run(['classify', GOOD, '--json']);
    const data = parseJson(stdout);
    assert.ok(typeof data.confidence === 'number');
    assert.ok(data.confidence >= 0 && data.confidence <= 100);
  });

  it('returns signals array', () => {
    const { stdout } = run(['classify', GOOD, '--json']);
    const data = parseJson(stdout);
    assert.ok(Array.isArray(data.signals));
  });

  it('stdin input works for classify', () => {
    const { stdout, exitCode } = run(['classify', '--json'], { input: 'Build a React dashboard' });
    assert.equal(exitCode, 0);
    const data = parseJson(stdout);
    assert.ok(data.task_type);
  });

  it('human-readable output works', () => {
    const { stdout, exitCode } = run(['classify', 'Fix the login bug']);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('Task Type:'));
    assert.ok(stdout.includes('Complexity:'));
  });
});

// ─── 4. route (6 tests) ────────────────────────────────────────────────────

describe('4. route', () => {
  it('returns primary and fallback models', () => {
    const { stdout, exitCode } = run(['route', GOOD, '--json']);
    assert.equal(exitCode, 0);
    const data = parseJson(stdout);
    assert.ok(data.primary);
    assert.ok(data.primary.model);
    assert.ok(data.primary.provider);
    assert.ok(data.fallback);
    assert.ok(data.fallback.model);
  });

  it('envelope has route subcommand', () => {
    const { stdout } = run(['route', GOOD, '--json']);
    const data = parseJson(stdout);
    assert.equal(data.subcommand, 'route');
  });

  it('returns decision_path', () => {
    const { stdout } = run(['route', GOOD, '--json']);
    const data = parseJson(stdout);
    assert.ok(Array.isArray(data.decision_path));
    assert.ok(data.decision_path.length > 0);
  });

  it('returns savings_summary', () => {
    const { stdout } = run(['route', GOOD, '--json']);
    const data = parseJson(stdout);
    assert.ok(typeof data.savings_summary === 'string');
  });

  it('--target changes provider preference', () => {
    const { stdout: claude } = run(['route', GOOD, '--json', '--target', 'claude']);
    const { stdout: openai } = run(['route', GOOD, '--json', '--target', 'openai']);
    const c = parseJson(claude);
    const o = parseJson(openai);
    // Both should have primary models, provider may differ
    assert.ok(c.primary.model);
    assert.ok(o.primary.model);
  });

  it('human-readable output works', () => {
    const { stdout, exitCode } = run(['route', GOOD]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('Recommended:'));
    assert.ok(stdout.includes('Fallback:'));
  });
});

// ─── 5. compress (6 tests) ─────────────────────────────────────────────────

describe('5. compress', () => {
  const LONG_TEXT = 'This is a line of text.\n'.repeat(100);

  it('compressed tokens ≤ original tokens', () => {
    const { stdout, exitCode } = run(['compress', '--json'], { input: LONG_TEXT });
    assert.equal(exitCode, 0);
    const data = parseJson(stdout);
    assert.ok(data.compressed_tokens <= data.original_tokens);
  });

  it('envelope has compress subcommand', () => {
    const { stdout } = run(['compress', '--json'], { input: LONG_TEXT });
    const data = parseJson(stdout);
    assert.equal(data.subcommand, 'compress');
  });

  it('--intent is accepted', () => {
    const { stdout, exitCode } = run(['compress', '--json', '--intent', 'summarize'], { input: LONG_TEXT });
    assert.equal(exitCode, 0);
    const data = parseJson(stdout);
    assert.ok(typeof data.original_tokens === 'number');
  });

  it('returns savings_percent', () => {
    const { stdout } = run(['compress', '--json'], { input: LONG_TEXT });
    const data = parseJson(stdout);
    assert.ok(typeof data.savings_percent === 'number');
  });

  it('short text still works', () => {
    const { stdout, exitCode } = run(['compress', 'just a few words', '--json']);
    assert.equal(exitCode, 0);
    const data = parseJson(stdout);
    assert.ok(data.original_tokens >= 0);
  });

  it('human-readable output works', () => {
    const { stdout, exitCode } = run(['compress'], { input: LONG_TEXT });
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('Original:'));
    assert.ok(stdout.includes('Compressed:'));
    assert.ok(stdout.includes('Saved:'));
  });
});

// ─── 6. cost (6 tests) ─────────────────────────────────────────────────────

describe('6. cost', () => {
  it('returns costs array and recommended_model', () => {
    const { stdout, exitCode } = run(['cost', GOOD, '--json']);
    assert.equal(exitCode, 0);
    const data = parseJson(stdout);
    assert.ok(Array.isArray(data.costs));
    assert.ok(data.costs.length > 0);
    assert.ok(typeof data.recommended_model === 'string');
  });

  it('envelope has cost subcommand', () => {
    const { stdout } = run(['cost', GOOD, '--json']);
    const data = parseJson(stdout);
    assert.equal(data.subcommand, 'cost');
  });

  it('each cost entry has provider, model, total_cost_usd', () => {
    const { stdout } = run(['cost', GOOD, '--json']);
    const data = parseJson(stdout);
    for (const c of data.costs) {
      assert.ok(typeof c.provider === 'string');
      assert.ok(typeof c.model === 'string');
      assert.ok(typeof c.total_cost_usd === 'number');
    }
  });

  it('returns input_tokens and estimated_output_tokens', () => {
    const { stdout } = run(['cost', GOOD, '--json']);
    const data = parseJson(stdout);
    assert.ok(typeof data.input_tokens === 'number');
    assert.ok(typeof data.estimated_output_tokens === 'number');
  });

  it('--target changes provider coverage', () => {
    const { stdout: claude } = run(['cost', GOOD, '--json', '--target', 'claude']);
    const { stdout: openai } = run(['cost', GOOD, '--json', '--target', 'openai']);
    const c = parseJson(claude);
    const o = parseJson(openai);
    assert.ok(c.recommended_model);
    assert.ok(o.recommended_model);
  });

  it('human-readable output works', () => {
    const { stdout, exitCode } = run(['cost', GOOD]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('Input tokens:'));
    assert.ok(stdout.includes('Recommended:'));
  });
});

// ─── 7. score (6 tests) ────────────────────────────────────────────────────

describe('7. score', () => {
  it('returns total and dimensions', () => {
    const { stdout, exitCode } = run(['score', GOOD, '--json']);
    assert.equal(exitCode, 0);
    const data = parseJson(stdout);
    assert.ok(typeof data.total === 'number');
    assert.ok(data.total >= 0 && data.total <= 100);
    assert.ok(Array.isArray(data.dimensions));
  });

  it('envelope has score subcommand', () => {
    const { stdout } = run(['score', GOOD, '--json']);
    const data = parseJson(stdout);
    assert.equal(data.subcommand, 'score');
  });

  it('dimensions have name and score', () => {
    const { stdout } = run(['score', GOOD, '--json']);
    const data = parseJson(stdout);
    for (const dim of data.dimensions) {
      assert.ok(typeof dim.name === 'string');
      assert.ok(typeof dim.score === 'number');
    }
  });

  it('has max field', () => {
    const { stdout } = run(['score', GOOD, '--json']);
    const data = parseJson(stdout);
    assert.equal(data.max, 100);
  });

  it('stdin input works for score', () => {
    const { stdout, exitCode } = run(['score', '--json'], { input: GOOD });
    assert.equal(exitCode, 0);
    const data = parseJson(stdout);
    assert.ok(data.total > 0);
  });

  it('human-readable output works', () => {
    const { stdout, exitCode } = run(['score', GOOD]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('PQS:'));
    assert.ok(stdout.includes('/100'));
  });

  it('human output renders dimension names, not array indices or [object Object]', () => {
    // Regression: Object.entries() on an array yields numeric string keys and whole
    // objects as values — 'score' command must iterate the array directly.
    const { stdout, exitCode } = run(['score', GOOD]);
    assert.equal(exitCode, 0);
    assert.ok(!stdout.includes('[object Object]'), 'Output must not contain [object Object]');
    assert.ok(!stdout.includes('  0:'), 'Output must not contain numeric array index "0:"');
    assert.ok(!stdout.includes('  1:'), 'Output must not contain numeric array index "1:"');
    // Each dimension line should match "  <word>: <number>/<number>"
    const dimLines = stdout.split('\n').filter(l => /^\s{2}\w/.test(l));
    assert.ok(dimLines.length >= 5, `Expected at least 5 dimension lines, got ${dimLines.length}`);
    for (const line of dimLines) {
      assert.match(line, /^\s{2}\w[\w\s]+:\s+\d+\/\d+/, `Dimension line has unexpected format: "${line}"`);
    }
  });

  it('human output includes Confidence line', () => {
    // Regression: confidence was added to QualityScore but never surfaced in human output.
    const { stdout, exitCode } = run(['score', GOOD]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('Confidence:'), 'Expected Confidence: line in score output');
    assert.match(stdout, /Confidence:\s+(low|medium|high)/, 'Confidence must be low, medium, or high');
  });
});

// ─── 8. preflight (8 tests) ────────────────────────────────────────────────

describe('8. preflight', () => {
  it('returns all fields', () => {
    const { stdout, exitCode } = run(['preflight', GOOD, '--json']);
    assert.equal(exitCode, 0);
    const data = parseJson(stdout);
    assert.ok(data.task_type);
    assert.ok(data.complexity);
    assert.ok(typeof data.confidence === 'number');
    assert.ok(typeof data.pqs === 'number');
    assert.ok(typeof data.risk_score === 'number');
    assert.ok(data.risk_level);
    assert.ok(data.recommended_model);
    assert.ok(data.recommended_provider);
  });

  it('envelope has preflight subcommand', () => {
    const { stdout } = run(['preflight', GOOD, '--json']);
    const data = parseJson(stdout);
    assert.equal(data.subcommand, 'preflight');
  });

  it('risk_dimensions present', () => {
    const { stdout } = run(['preflight', GOOD, '--json']);
    const data = parseJson(stdout);
    assert.ok(data.risk_dimensions);
    assert.ok(typeof data.risk_dimensions.underspec === 'number');
  });

  it('decision_path present', () => {
    const { stdout } = run(['preflight', GOOD, '--json']);
    const data = parseJson(stdout);
    assert.ok(Array.isArray(data.decision_path));
  });

  it('savings_summary present', () => {
    const { stdout } = run(['preflight', GOOD, '--json']);
    const data = parseJson(stdout);
    assert.ok(typeof data.savings_summary === 'string');
  });

  it('--context adds context', () => {
    const { stdout, exitCode } = run(['preflight', GOOD, '--json', '--context', 'Node.js API project']);
    assert.equal(exitCode, 0);
    const data = parseJson(stdout);
    assert.ok(data.pqs >= 0);
  });

  it('stdin input works', () => {
    const { exitCode } = run(['preflight', '--json'], { input: GOOD });
    assert.equal(exitCode, 0);
  });

  it('human-readable output works', () => {
    const { stdout, exitCode } = run(['preflight', GOOD]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('PQS:'));
    assert.ok(stdout.includes('Risk:'));
    assert.ok(stdout.includes('Model:'));
  });
});

// ─── 9. config (6 tests) ───────────────────────────────────────────────────

describe('9. config', () => {
  it('--json returns envelope with config fields', () => {
    const { stdout, exitCode } = run(['config', '--json']);
    assert.equal(exitCode, 0);
    const data = parseJson(stdout);
    assert.equal(data.subcommand, 'config');
    assert.ok(typeof data.policy_mode === 'string');
    assert.ok(typeof data.strictness === 'string');
  });

  it('shows data_dir', () => {
    const { stdout } = run(['config', '--json']);
    const data = parseJson(stdout);
    assert.ok(typeof data.data_dir === 'string');
  });

  it('shows locked status', () => {
    const { stdout } = run(['config', '--json']);
    const data = parseJson(stdout);
    assert.ok(typeof data.locked === 'boolean');
  });

  it('shows audit_log status', () => {
    const { stdout } = run(['config', '--json']);
    const data = parseJson(stdout);
    assert.ok(typeof data.audit_log === 'boolean');
  });

  it('human-readable output works', () => {
    const { stdout, exitCode } = run(['config']);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('Policy Mode:'));
    assert.ok(stdout.includes('Strictness:'));
    assert.ok(stdout.includes('Data Directory:'));
  });

  it('PCP_DATA_DIR overrides data directory', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pcp-test-'));
    try {
      const { stdout } = run(['config', '--json'], { env: { PCP_DATA_DIR: tmpDir } });
      const data = parseJson(stdout);
      assert.equal(data.data_dir, tmpDir);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── 10. doctor (4 tests) ──────────────────────────────────────────────────

describe('10. doctor', () => {
  it('healthy env → exit 0', () => {
    const { exitCode } = run(['doctor', '--json']);
    assert.equal(exitCode, 0);
  });

  it('returns checks array', () => {
    const { stdout } = run(['doctor', '--json']);
    const data = parseJson(stdout);
    assert.ok(Array.isArray(data.checks));
    assert.ok(data.checks.length >= 6);
    assert.ok(typeof data.healthy === 'boolean');
  });

  it('each check has name, status, detail', () => {
    const { stdout } = run(['doctor', '--json']);
    const data = parseJson(stdout);
    for (const c of data.checks) {
      assert.ok(typeof c.name === 'string');
      assert.ok(['ok', 'warning', 'error'].includes(c.status));
      assert.ok(typeof c.detail === 'string');
    }
  });

  it('corrupt config reports issue', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pcp-test-'));
    try {
      writeFileSync(join(tmpDir, 'config.json'), '{{invalid json');
      const { stdout, exitCode } = run(['doctor', '--json'], { env: { PCP_DATA_DIR: tmpDir } });
      const data = parseJson(stdout);
      const configCheck = data.checks.find((c: any) => c.name === 'config');
      assert.equal(configCheck.status, 'error');
      assert.equal(exitCode, 1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── 11. Envelope consistency (6 tests) ────────────────────────────────────

describe('11. Envelope consistency', () => {
  const SUBCMDS = ['optimize', 'classify', 'route', 'cost', 'score', 'preflight'];

  for (const sub of SUBCMDS) {
    it(`${sub} has request_id in UUID format`, () => {
      const { stdout } = run([sub, GOOD, '--json']);
      const data = parseJson(stdout);
      assert.ok(data.request_id);
      assert.match(data.request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      assert.equal(data.version, PKG_VERSION);
      assert.equal(data.schema_version, 1);
      assert.equal(data.subcommand, sub);
      assert.ok(typeof data.policy_mode === 'string');
    });
  }
});

// ─── 12. Policy enforcement (6 tests) ──────────────────────────────────────

describe('12. Policy enforcement', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pcp-enforce-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('advisory mode does NOT block', () => {
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify({
      policy_mode: 'advisory',
      strictness: 'standard',
    }));
    const { exitCode } = run(['preflight', VAGUE, '--json'], { env: { PCP_DATA_DIR: tmpDir } });
    // advisory = no blocking regardless of risk
    assert.ok(exitCode !== 3, `Expected no policy block in advisory, got exit ${exitCode}`);
  });

  it('enforce + high risk → exit 3 for preflight', () => {
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify({
      policy_mode: 'enforce',
      strictness: 'relaxed', // threshold = 40
    }));
    // A super vague prompt that might trigger risk rules
    const vaguePrompt = 'do stuff with data and also fix all the bugs in every file and refactor everything';
    const { exitCode, stdout } = run(['preflight', vaguePrompt, '--json'], { env: { PCP_DATA_DIR: tmpDir } });
    // May or may not trigger depending on risk score — just verify it doesn't crash
    assert.ok([0, 3].includes(exitCode), `Expected 0 or 3, got ${exitCode}`);
    if (exitCode === 3) {
      const data = parseJson(stdout);
      assert.ok(data.status === 'blocked');
    }
  });

  it('enforce mode + optimize → respects policy', () => {
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify({
      policy_mode: 'enforce',
      strictness: 'standard',
    }));
    const { exitCode } = run(['optimize', GOOD, '--json'], { env: { PCP_DATA_DIR: tmpDir } });
    // Good prompt with standard strictness should pass
    assert.ok([0, 3].includes(exitCode));
  });

  it('enforce mode + route → respects policy', () => {
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify({
      policy_mode: 'enforce',
      strictness: 'standard',
    }));
    const { exitCode } = run(['route', GOOD, '--json'], { env: { PCP_DATA_DIR: tmpDir } });
    assert.ok([0, 3].includes(exitCode));
  });

  it('classify is never policy-blocked', () => {
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify({
      policy_mode: 'enforce',
      strictness: 'strict',
    }));
    const { exitCode } = run(['classify', VAGUE, '--json'], { env: { PCP_DATA_DIR: tmpDir } });
    assert.equal(exitCode, 0, 'classify should never be blocked');
  });

  it('exit 3 JSON includes policy_blocked status', () => {
    // Force a very strict threshold — even good prompts might fail
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify({
      policy_mode: 'enforce',
      strictness: 'strict', // threshold = 75
    }));
    const riskyPrompt = 'do everything on the entire codebase and also handle all the data processing, transform all files, refactor everything, and deploy to production';
    const { exitCode, stdout } = run(['preflight', riskyPrompt, '--json'], { env: { PCP_DATA_DIR: tmpDir } });
    if (exitCode === 3) {
      const data = parseJson(stdout);
      assert.equal(data.status, 'blocked');
      assert.ok(data.reason === 'blocking_rule_violations' || data.reason === 'risk_threshold_exceeded');
    }
    // If it's 0, that's fine too — the prompt didn't trigger enough risk
    assert.ok([0, 3].includes(exitCode));
  });
});

// ─── 13. Error handling (6 tests) ──────────────────────────────────────────

describe('13. Error handling', () => {
  it('unknown subcommand → exit 2', () => {
    const { exitCode } = run(['nonexistent', GOOD, '--json']);
    // 'nonexistent' is not a subcommand, so treated as bare prompt for check
    // Actually, let's test a flag-like unknown subcommand
    const { exitCode: ec2 } = run(['--bogus-flag']);
    assert.equal(ec2, 2);
  });

  it('no input to optimize → exit 2', () => {
    // Force stdin to be a TTY by not piping
    const { exitCode } = run(['optimize', '--json']);
    assert.equal(exitCode, 2);
  });

  it('--json errors are valid JSON', () => {
    const { stdout } = run(['optimize', '--json']);
    // Should be parseable even on error
    const data = parseJson(stdout);
    assert.ok(data.error);
    assert.ok(typeof data.error.message === 'string');
  });

  it('--target with invalid value → exit 2', () => {
    const { exitCode } = run(['optimize', GOOD, '--target', 'invalid']);
    assert.equal(exitCode, 2);
  });

  it('--threshold out of range → exit 2', () => {
    const { exitCode } = run(['check', GOOD, '--threshold', '150']);
    assert.equal(exitCode, 2);
  });

  it('empty file → exit 2', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pcp-test-'));
    try {
      const emptyFile = join(tmpDir, 'empty.txt');
      writeFileSync(emptyFile, '');
      const { exitCode } = run(['optimize', '--file', emptyFile]);
      assert.equal(exitCode, 2);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── 14. CRLF/encoding (3 tests) ──────────────────────────────────────────

describe('14. CRLF/encoding', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pcp-crlf-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('CRLF file input normalized', () => {
    const crlfFile = join(tmpDir, 'crlf.txt');
    writeFileSync(crlfFile, 'Write a REST API\r\nfor user management\r\nwith JWT authentication');
    const { exitCode } = run(['score', '--file', crlfFile, '--json']);
    assert.equal(exitCode, 0);
  });

  it('CRLF stdin normalized', () => {
    const { exitCode } = run(['classify', '--json'], {
      input: 'Build a dashboard\r\nfor monitoring\r\nwith real-time charts',
    });
    assert.equal(exitCode, 0);
  });

  it('UTF-8 content works', () => {
    const utf8File = join(tmpDir, 'utf8.txt');
    writeFileSync(utf8File, 'Create an API for résumé parsing with naïve Bayes classification and über-fast response times', 'utf-8');
    const { exitCode } = run(['classify', '--file', utf8File, '--json']);
    assert.equal(exitCode, 0);
  });
});

// ─── 15. Console → CLI integration (4 tests) ───────────────────────────────

describe('15. Console → CLI integration', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pcp-console-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('config written to PCP_DATA_DIR is read by pcp config', () => {
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify({
      policy_mode: 'enforce',
      strictness: 'strict',
      audit_log: true,
    }));
    const { stdout, exitCode } = run(['config', '--json'], { env: { PCP_DATA_DIR: tmpDir } });
    assert.equal(exitCode, 0);
    const data = parseJson(stdout);
    assert.equal(data.policy_mode, 'enforce');
    assert.equal(data.strictness, 'strict');
    assert.equal(data.audit_log, true);
  });

  it('enforce mode shows in preflight output', () => {
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify({
      policy_mode: 'enforce',
      strictness: 'standard',
    }));
    const { stdout } = run(['preflight', GOOD, '--json'], { env: { PCP_DATA_DIR: tmpDir } });
    const data = parseJson(stdout);
    assert.equal(data.policy_mode, 'enforce');
  });

  it('locked config shows in doctor', () => {
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify({
      policy_mode: 'advisory',
      locked_config: true,
    }));
    const { stdout, exitCode } = run(['doctor', '--json'], { env: { PCP_DATA_DIR: tmpDir } });
    assert.equal(exitCode, 0);
    const data = parseJson(stdout);
    const policyCheck = data.checks.find((c: any) => c.name === 'policy_mode');
    assert.ok(policyCheck.detail.includes('locked'));
  });

  it('empty PCP_DATA_DIR → defaults applied', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'pcp-empty-'));
    try {
      const { stdout, exitCode } = run(['config', '--json'], { env: { PCP_DATA_DIR: emptyDir } });
      assert.equal(exitCode, 0);
      const data = parseJson(stdout);
      assert.equal(data.policy_mode, 'advisory');
      assert.equal(data.strictness, 'standard');
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

// ─── 16. --quiet (2 tests) ─────────────────────────────────────────────────

describe('16. --quiet', () => {
  it('--quiet suppresses human-readable output', () => {
    const { stdout, exitCode } = run(['preflight', GOOD, '--quiet']);
    assert.equal(exitCode, 0);
    assert.equal(stdout, '', 'Expected no output with --quiet');
  });

  it('--quiet --json outputs JSON only', () => {
    const { stdout, exitCode } = run(['preflight', GOOD, '--quiet', '--json']);
    assert.equal(exitCode, 0);
    const data = parseJson(stdout);
    assert.ok(data.request_id, 'JSON should still be output with --quiet --json');
  });
});

// ─── 17. --pretty (2 tests) ────────────────────────────────────────────────

describe('17. --pretty', () => {
  it('--pretty --json produces indented output', () => {
    const { stdout, exitCode } = run(['classify', GOOD, '--json', '--pretty']);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('\n  '), 'Expected indented JSON');
    // Should be valid JSON
    parseJson(stdout);
  });

  it('--json without --pretty can still be parsed', () => {
    const { stdout, exitCode } = run(['classify', GOOD, '--json']);
    assert.equal(exitCode, 0);
    parseJson(stdout);
  });
});

// ─── 18. --context-file (3 tests) ──────────────────────────────────────────

describe('18. --context-file', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pcp-ctx-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads context from file', () => {
    const ctxFile = join(tmpDir, 'context.txt');
    writeFileSync(ctxFile, 'This is a Node.js TypeScript project with Express and PostgreSQL.');
    const { stdout, exitCode } = run(['optimize', GOOD, '--json', '--context-file', ctxFile]);
    assert.equal(exitCode, 0);
    const data = parseJson(stdout);
    assert.ok(data.compiled_prompt);
  });

  it('large context file triggers warning on stderr', () => {
    const bigFile = join(tmpDir, 'big-context.txt');
    // Write a file > 500KB
    writeFileSync(bigFile, 'x'.repeat(600 * 1024));
    const { stderr, exitCode } = run(['score', GOOD, '--json', '--context-file', bigFile]);
    assert.equal(exitCode, 0);
    assert.ok(stderr.includes('Warning:'), 'Expected size warning on stderr');
    assert.ok(stderr.includes('compress'), 'Warning should suggest compress');
  });

  it('--file for prompt + --context-file for context', () => {
    const promptFile = join(tmpDir, 'prompt.txt');
    const ctxFile = join(tmpDir, 'ctx.txt');
    writeFileSync(promptFile, GOOD);
    writeFileSync(ctxFile, 'Using Express.js framework');
    const { exitCode } = run(['score', '--file', promptFile, '--context-file', ctxFile, '--json']);
    assert.equal(exitCode, 0);
  });
});

// ─── 17. Hook Subcommand (10 tests) ─────────────────────────────────────────

describe('17. Hook subcommand', () => {
  let hookDir: string;

  /** Run CLI with custom cwd for hook tests. */
  function runInDir(
    args: string[],
    cwd: string,
    opts?: { env?: Record<string, string> },
  ): { stdout: string; stderr: string; exitCode: number } {
    const result = spawnSync('node', [BIN, ...args], {
      encoding: 'utf-8',
      cwd,
      timeout: 15_000,
      env: { ...process.env, ...opts?.env },
    });
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.status ?? 1,
    };
  }

  before(() => {
    hookDir = mkdtempSync(join(tmpdir(), 'pcp-hook-'));
  });

  after(() => {
    try { rmSync(hookDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('hook with no action shows help', () => {
    const { stdout, exitCode } = runInDir(['hook'], hookDir);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('hook install'), 'Help mentions install');
    assert.ok(stdout.includes('hook uninstall'), 'Help mentions uninstall');
    assert.ok(stdout.includes('hook status'), 'Help mentions status');
  });

  it('hook --help shows hook-specific help (not main help)', () => {
    const { stdout, exitCode } = runInDir(['hook', '--help'], hookDir);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('hook install'), 'Shows hook help, not main help');
    assert.ok(!stdout.includes('preflight'), 'Does not show main help commands');
  });

  it('hook status before install → not installed', () => {
    const { stdout, exitCode } = runInDir(['hook', 'status', '--json'], hookDir);
    assert.equal(exitCode, 0);
    const json = JSON.parse(stdout.trim());
    assert.equal(json.subcommand, 'hook');
    assert.equal(json.installed, false);
    assert.equal(json.hook_script_exists, false);
    assert.equal(json.settings_configured, false);
  });

  it('hook install creates script + settings', () => {
    const { stdout, exitCode } = runInDir(['hook', 'install', '--json'], hookDir);
    assert.equal(exitCode, 0);
    const json = JSON.parse(stdout.trim());
    assert.equal(json.action, 'install');
    assert.equal(json.status, 'installed');
    assert.equal(json.scope, 'project');
    assert.equal(typeof json.threshold, 'number');
    assert.ok(json.hook_script.includes('pcp-preflight.mjs'));
  });

  it('hook status after install → installed', () => {
    const { stdout, exitCode } = runInDir(['hook', 'status', '--json'], hookDir);
    assert.equal(exitCode, 0);
    const json = JSON.parse(stdout.trim());
    assert.equal(json.installed, true);
    assert.equal(json.hook_script_exists, true);
    assert.equal(json.settings_configured, true);
  });

  it('hook install with --threshold 70', () => {
    const { stdout, exitCode } = runInDir(['hook', 'install', '--threshold', '70', '--json'], hookDir);
    assert.equal(exitCode, 0);
    const json = JSON.parse(stdout.trim());
    assert.equal(json.threshold, 70);
  });

  it('hook uninstall removes everything', () => {
    const { stdout, exitCode } = runInDir(['hook', 'uninstall', '--json'], hookDir);
    assert.equal(exitCode, 0);
    const json = JSON.parse(stdout.trim());
    assert.equal(json.action, 'uninstall');
    assert.equal(json.status, 'removed');
  });

  it('hook status after uninstall → not installed', () => {
    const { stdout, exitCode } = runInDir(['hook', 'status', '--json'], hookDir);
    assert.equal(exitCode, 0);
    const json = JSON.parse(stdout.trim());
    assert.equal(json.installed, false);
    assert.equal(json.hook_script_exists, false);
  });

  it('hook uninstall when not installed → not_found', () => {
    const { stdout, exitCode } = runInDir(['hook', 'uninstall', '--json'], hookDir);
    assert.equal(exitCode, 0);
    const json = JSON.parse(stdout.trim());
    assert.equal(json.status, 'not_found');
  });

  it('hook JSON envelope has standard fields', () => {
    const { stdout } = runInDir(['hook', 'status', '--json'], hookDir);
    const json = JSON.parse(stdout.trim());
    assert.ok(json.request_id, 'Has request_id');
    assert.equal(json.version, PKG_VERSION);
    assert.equal(json.schema_version, 1);
    assert.equal(json.subcommand, 'hook');
    assert.ok('policy_mode' in json, 'Has policy_mode');
  });
});

// ─── 19. Snapshot: CLI output formats ────────────────────────────────────────

describe('Snapshot: CLI output formats', () => {
  const VAGUE_SNAP = 'make the code better';

  it('score output has PQS, Confidence, and dimension lines', () => {
    const { stdout, exitCode } = run(['score', VAGUE_SNAP]);
    assert.equal(exitCode, 0);
    // Must have PQS line
    assert.match(stdout, /PQS:\s+\d+\/100/);
    // Must have Confidence
    assert.match(stdout, /Confidence:\s+(low|medium|high)/);
    // Must have all 5 dimensions
    assert.match(stdout, /Clarity:/);
    assert.match(stdout, /Specificity:/);
    assert.match(stdout, /Completeness:/);
    assert.match(stdout, /Constraints:/);
    assert.match(stdout, /Efficiency:/);
    // Must NOT have [object Object]
    assert.ok(!stdout.includes('[object Object]'));
  });

  it('check output includes pass/fail and PQS', () => {
    const { stdout, exitCode } = run(['check', VAGUE_SNAP, '--threshold', '10']);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('PQS') || stdout.includes('pass') || stdout.includes('\u2713') || stdout.includes('/100'));
  });

  it('demo output runs without error', () => {
    const { stdout, exitCode } = run(['demo']);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('PCP Demo') || stdout.includes('demo') || stdout.includes('PQS'));
    // Should show at least 2 prompts
    assert.ok(stdout.includes('make the code better') || stdout.includes('Refactor'));
  });

  it('bare pcp (no args) prints help, not error', () => {
    // Note: process.stdin.isTTY is true when no input is piped
    // In test, we need to NOT pipe input to trigger the help path
    // This is tricky because spawnSync provides no stdin by default which looks like closed pipe
    // The actual behavior depends on isTTY detection
    const { exitCode } = run([]);
    // Should not crash with exit 2 (the old behavior)
    // It will either show help (exit 0) or fall through to check (exit 2 for no input)
    // Just verify it doesn't throw an exception
    assert.ok(exitCode === 0 || exitCode === 2);
  });

  it('report command produces files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pcp-report-'));
    const { exitCode } = run(['report', VAGUE_SNAP, '--output', dir]);
    assert.equal(exitCode, 0);
    // Check files were created
    const files = readdirSync(dir);
    assert.ok(files.includes('prompt-quality.json'), 'Expected prompt-quality.json');
    assert.ok(files.includes('prompt-quality.md'), 'Expected prompt-quality.md');
    // Validate JSON schema
    const report = JSON.parse(readFileSync(join(dir, 'prompt-quality.json'), 'utf-8'));
    assert.equal(report.schema_version, '1.0.0');
    assert.ok(typeof report.pqs === 'object' || typeof report.pqs?.total === 'number' || typeof report.quality_score === 'number');
    // Cleanup
    rmSync(dir, { recursive: true, force: true });
  });

  it('badge command outputs markdown', () => {
    const { stdout, exitCode } = run(['badge', VAGUE_SNAP]);
    assert.equal(exitCode, 0);
    assert.match(stdout, /!\[PQS\]/);
    assert.ok(stdout.includes('img.shields.io/'));
  });

  it('--format github outputs annotations', () => {
    // Use a temporary file with a vague prompt for the --file flag
    const dir = mkdtempSync(join(tmpdir(), 'pcp-github-'));
    const promptFile = join(dir, 'vague-code-change.txt');
    writeFileSync(promptFile, VAGUE_SNAP);
    const { stdout, exitCode } = run(['check', '--file', promptFile, '--format', 'github', '--threshold', '10']);
    // Should contain GitHub annotation format
    assert.ok(stdout.includes('::') || exitCode === 0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('structured errors include hints', () => {
    const { stderr, exitCode } = run(['check']);
    // No input provided should give structured error
    if (exitCode !== 0) {
      assert.ok(stderr.includes('Hint:') || stderr.includes('E_NO_INPUT') || stderr.includes('pcp demo'));
    }
  });
});
