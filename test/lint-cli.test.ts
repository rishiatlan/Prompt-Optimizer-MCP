// test/lint-cli.test.ts — CLI tests for prompt-lint.
// CRITICAL: All tests spawn `node bin/lint.js` as a child process to test real exit codes.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// After compilation, __dirname = dist/test/. bin/ and test/fixtures/ live at repo root.
const ROOT = resolve(__dirname, '..', '..');
const BIN = resolve(ROOT, 'bin', 'lint.js');
const FIXTURES = resolve(ROOT, 'test', 'fixtures');
const GOOD_PROMPT = resolve(FIXTURES, 'good-prompt.txt');
const BAD_PROMPT = resolve(FIXTURES, 'bad-prompt.txt');

/** Run the CLI and return { stdout, stderr, exitCode }. */
function run(
  args: string[],
  opts?: { input?: string; cwd?: string },
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      encoding: 'utf-8',
      input: opts?.input,
      cwd: opts?.cwd ?? ROOT,
      timeout: 15_000,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
      exitCode: err.status ?? 1,
    };
  }
}

// ─── Basic Pass/Fail ─────────────────────────────────────────────────────────

describe('prompt-lint CLI', () => {
  it('good prompt above threshold → exit 0, PASS', () => {
    const { stdout, exitCode } = run([
      'Write a REST API for user management with authentication using JWT tokens, rate limiting, input validation, and PostgreSQL storage',
    ]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('PASS'), 'Expected PASS in output');
  });

  it('vague prompt below threshold → exit 1, FAIL', () => {
    const { stdout, exitCode } = run(['make it better']);
    assert.equal(exitCode, 1);
    assert.ok(stdout.includes('FAIL'), 'Expected FAIL in output');
  });

  // ─── Threshold Flag ──────────────────────────────────────────────────────

  it('--threshold overrides default', () => {
    // With very low threshold, even vague prompt passes
    const { exitCode } = run(['--threshold', '1', 'make it better']);
    assert.equal(exitCode, 0);
  });

  it('--threshold with high value fails good prompt', () => {
    const { exitCode } = run([
      '--threshold', '99',
      'Write a REST API for user management with authentication',
    ]);
    assert.equal(exitCode, 1);
  });

  // ─── Strict/Relaxed Presets ──────────────────────────────────────────────

  it('--strict sets threshold to 75', () => {
    const { stdout, exitCode } = run(['--strict', '--json', 'make it better']);
    assert.equal(exitCode, 1);
    const data = JSON.parse(stdout);
    assert.equal(data.threshold, 75);
  });

  it('--relaxed sets threshold to 40', () => {
    const { stdout } = run(['--relaxed', '--json', 'make it better']);
    const data = JSON.parse(stdout);
    assert.equal(data.threshold, 40);
  });

  it('--strict + --relaxed together → exit 2', () => {
    const { exitCode } = run(['--strict', '--relaxed', 'test']);
    assert.equal(exitCode, 2);
  });

  // ─── JSON Output ─────────────────────────────────────────────────────────

  it('--json outputs valid JSON with expected shape', () => {
    const { stdout, exitCode } = run([
      '--json',
      'Write a REST API for user management with JWT authentication, rate limiting at 100 req/min, Zod input validation, PostgreSQL storage, and proper HTTP status codes',
    ]);
    assert.equal(exitCode, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.version, 'Expected version field');
    assert.ok(typeof data.threshold === 'number', 'Expected threshold field');
    assert.ok(Array.isArray(data.results), 'Expected results array');
    assert.ok(data.summary, 'Expected summary field');
    assert.ok(typeof data.summary.total === 'number');
    assert.ok(typeof data.summary.passed === 'number');
    assert.ok(typeof data.summary.failed === 'number');
  });

  it('--json + exit 1 outputs valid JSON', () => {
    const { stdout, exitCode } = run(['--json', 'make it better']);
    assert.equal(exitCode, 1);
    const data = JSON.parse(stdout);
    assert.ok(data.results);
    assert.ok(data.summary.failed > 0);
  });

  it('--json + exit 2 (invalid args) outputs valid JSON error shape', () => {
    const { stdout, exitCode } = run(['--json', '--strict', '--relaxed', 'test']);
    assert.equal(exitCode, 2);
    const data = JSON.parse(stdout);
    assert.ok(data.error, 'Expected error object');
    assert.equal(data.error.code, 2);
    assert.ok(typeof data.error.message === 'string');
  });

  it('--json + exit 2 (no files matched) outputs valid JSON error shape', () => {
    const { stdout, exitCode } = run(['--json', '--file', 'nonexistent-glob-pattern-*.xyz']);
    assert.equal(exitCode, 2);
    const data = JSON.parse(stdout);
    assert.ok(data.error, 'Expected error object');
    assert.equal(data.error.code, 2);
  });

  it('--json output has no non-JSON prelude (no banner)', () => {
    const { stdout } = run(['--json', 'make it better']);
    // First non-whitespace character must be '{' — no banner line
    assert.ok(stdout.trimStart().startsWith('{'), 'JSON output must start with {');
  });

  // ─── File Input ──────────────────────────────────────────────────────────

  it('--file reads from file', () => {
    const { stdout, exitCode } = run(['--file', GOOD_PROMPT]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('PASS'));
  });

  it('--file with bad prompt fails', () => {
    const { stdout, exitCode } = run(['--file', BAD_PROMPT]);
    assert.equal(exitCode, 1);
    assert.ok(stdout.includes('FAIL'));
  });

  it('--file with directory (recursive)', () => {
    const { stdout, exitCode } = run(['--file', FIXTURES]);
    // Directory has both good and bad prompts — at least one should fail
    assert.equal(exitCode, 1);
    assert.ok(stdout.includes('passed'));
    assert.ok(stdout.includes('failed'));
  });

  it('--file glob matches nothing → exit 2', () => {
    const { exitCode, stderr } = run(['--file', 'nonexistent-glob-pattern-*.xyz']);
    assert.equal(exitCode, 2);
  });

  // ─── Stdin Input ─────────────────────────────────────────────────────────

  it('stdin input works', () => {
    const { stdout, exitCode } = run([], {
      input: 'Write a REST API for user management with authentication, rate limiting, and input validation',
    });
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('PASS'));
  });

  it('empty stdin → exit 2', () => {
    const { exitCode } = run([], { input: '' });
    assert.equal(exitCode, 2);
  });

  it('whitespace-only stdin → exit 2', () => {
    const { exitCode } = run([], { input: '   \n\n  ' });
    assert.equal(exitCode, 2);
  });

  // ─── Input Mixing ────────────────────────────────────────────────────────

  it('prompt arg + --file together → exit 2', () => {
    const { exitCode } = run(['--file', GOOD_PROMPT, 'some prompt text']);
    assert.equal(exitCode, 2);
  });

  // ─── Invalid Args ────────────────────────────────────────────────────────

  it('unknown flag → exit 2', () => {
    const { exitCode } = run(['--unknown-flag', 'test']);
    assert.equal(exitCode, 2);
  });

  it('empty prompt string → exit 2', () => {
    const { exitCode } = run(['']);
    assert.equal(exitCode, 2);
  });

  // ─── Help/Version ────────────────────────────────────────────────────────

  it('--help prints usage and exits 0', () => {
    const { stdout, exitCode } = run(['--help']);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('Usage:'));
    assert.ok(stdout.includes('prompt-lint'));
  });

  it('--version prints version string and exits 0', () => {
    const { stdout, exitCode } = run(['--version']);
    assert.equal(exitCode, 0);
    assert.match(stdout.trim(), /^prompt-lint v\d+\.\d+\.\d+$/);
  });

  // ─── Threshold Validation ────────────────────────────────────────────────

  it('--threshold with non-integer → exit 2', () => {
    const { exitCode } = run(['--threshold', 'abc', 'test']);
    assert.equal(exitCode, 2);
  });

  it('--threshold with out-of-range (200) → exit 2', () => {
    const { exitCode } = run(['--threshold', '200', 'test']);
    assert.equal(exitCode, 2);
  });

  it('--threshold with negative → exit 2', () => {
    const { exitCode } = run(['--threshold', '-5', 'test']);
    assert.equal(exitCode, 2);
  });

  it('--threshold with float → exit 2', () => {
    const { exitCode } = run(['--threshold', '50.5', 'test']);
    assert.equal(exitCode, 2);
  });

  // ─── Deterministic Ordering ──────────────────────────────────────────────

  it('deterministic file ordering: two files always produce same order', () => {
    const { stdout: run1 } = run(['--json', '--file', FIXTURES]);
    const { stdout: run2 } = run(['--json', '--file', FIXTURES]);
    const data1 = JSON.parse(run1);
    const data2 = JSON.parse(run2);
    const sources1 = data1.results.map((r: any) => r.source);
    const sources2 = data2.results.map((r: any) => r.source);
    assert.deepEqual(sources1, sources2, 'File ordering must be deterministic');
    // Also verify alphabetical order
    const sorted = [...sources1].sort();
    assert.deepEqual(sources1, sorted, 'Files must be in alphabetical order');
  });
});
