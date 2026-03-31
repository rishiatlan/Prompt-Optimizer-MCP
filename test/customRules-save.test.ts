// test/customRules-save.test.ts — 15 tests for save_custom_rules (v4.1)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir, platform } from 'node:os';
import { randomUUID } from 'node:crypto';
import { CustomRulesManager } from '../src/customRules.js';
import type { CustomRule } from '../src/types.js';

function makeRule(overrides: Partial<CustomRule> = {}): CustomRule {
  return {
    id: `rule_${randomUUID().slice(0, 8).replace(/[^a-z0-9]/g, 'x')}`,
    description: 'Test rule',
    pattern: 'TODO|FIXME',
    applies_to: 'all',
    severity: 'NON-BLOCKING',
    risk_dimension: 'underspec',
    risk_weight: 5,
    ...overrides,
  } as CustomRule;
}

describe('save_custom_rules', async () => {

  // ─── Happy Path ────────────────────────────────────────────────────────

  it('1. saves valid rules and returns confirmation', async () => {
    const dir = path.join(tmpdir(), `rules-save-${randomUUID()}`);
    const mgr = new CustomRulesManager(dir);

    const rules = [makeRule({ id: 'brule' }), makeRule({ id: 'arule' })];
    const result = await mgr.saveRules(rules);

    assert.equal(result.saved_count, 2);
    assert.deepEqual(result.rule_ids, ['arule', 'brule']); // sorted
    assert.ok(result.rule_set_hash.length === 64); // SHA-256 hex
    assert.ok(result.file_path.endsWith('custom-rules.json'));
    assert.ok(result.created_at); // ISO string

    await fs.rm(dir, { recursive: true });
  });

  it('2. roundtrip: saveRules → loadRules returns identical rules', async () => {
    const dir = path.join(tmpdir(), `rules-rt-${randomUUID()}`);
    const mgr = new CustomRulesManager(dir);

    const rules = [
      makeRule({ id: 'alpha', pattern: 'test\\d+', risk_weight: 10 }),
      makeRule({ id: 'beta', pattern: 'hack', severity: 'BLOCKING', risk_dimension: 'hallucination' }),
    ];
    await mgr.saveRules(rules);

    const loaded = await mgr.loadRules();
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0].id, 'alpha');
    assert.equal(loaded[1].id, 'beta');
    assert.equal(loaded[0].pattern, 'test\\d+');
    assert.equal(loaded[1].severity, 'BLOCKING');

    await fs.rm(dir, { recursive: true });
  });

  it('3. hash is deterministic for same rules', async () => {
    const dir = path.join(tmpdir(), `rules-hash-${randomUUID()}`);
    const mgr = new CustomRulesManager(dir);

    const rules = [makeRule({ id: 'xrule', pattern: 'abc', risk_weight: 3 })];
    const r1 = await mgr.saveRules(rules);
    const r2 = await mgr.saveRules(rules);

    assert.equal(r1.rule_set_hash, r2.rule_set_hash);

    await fs.rm(dir, { recursive: true });
  });

  it('4. overwrite: second save replaces first set entirely', async () => {
    const dir = path.join(tmpdir(), `rules-ow-${randomUUID()}`);
    const mgr = new CustomRulesManager(dir);

    await mgr.saveRules([makeRule({ id: 'first' })]);
    await mgr.saveRules([makeRule({ id: 'second' }), makeRule({ id: 'third' })]);

    const loaded = await mgr.loadRules();
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0].id, 'second');
    assert.equal(loaded[1].id, 'third');

    await fs.rm(dir, { recursive: true });
  });

  it('5. creates directory if it does not exist', async () => {
    const dir = path.join(tmpdir(), `rules-mkdir-${randomUUID()}`, 'nested');
    const mgr = new CustomRulesManager(dir);

    await mgr.saveRules([makeRule({ id: 'dirrule' })]);
    const stat = await fs.stat(path.join(dir, 'custom-rules.json'));
    assert.ok(stat.isFile());

    await fs.rm(dir, { recursive: true });
  });

  it('6. file permissions are 600 on POSIX', async () => {
    if (platform() === 'win32') return; // skip on Windows

    const dir = path.join(tmpdir(), `rules-perm-${randomUUID()}`);
    const mgr = new CustomRulesManager(dir);

    await mgr.saveRules([makeRule({ id: 'permrule' })]);
    const stat = await fs.stat(path.join(dir, 'custom-rules.json'));
    const mode = stat.mode & 0o777;
    assert.equal(mode, 0o600);

    await fs.rm(dir, { recursive: true });
  });

  it('7. preserves negative_pattern and optional fields', async () => {
    const dir = path.join(tmpdir(), `rules-neg-${randomUUID()}`);
    const mgr = new CustomRulesManager(dir);

    const rule = makeRule({
      id: 'negrule',
      pattern: 'deploy',
      negative_pattern: 'staging',
      applies_to: 'code',
      risk_dimension: 'scope',
      risk_weight: 15,
    });
    await mgr.saveRules([rule]);

    const loaded = await mgr.loadRules();
    assert.equal(loaded[0].negative_pattern, 'staging');
    assert.equal(loaded[0].applies_to, 'code');
    assert.equal(loaded[0].risk_dimension, 'scope');
    assert.equal(loaded[0].risk_weight, 15);

    await fs.rm(dir, { recursive: true });
  });

  // ─── Validation Rejection ─────────────────────────────────────────────

  it('8. rejects invalid ID format', async () => {
    const dir = path.join(tmpdir(), `rules-badid-${randomUUID()}`);
    const mgr = new CustomRulesManager(dir);

    await assert.rejects(
      () => mgr.saveRules([makeRule({ id: '123_bad' })]),
      /Invalid rules/,
    );

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('9. rejects missing pattern', async () => {
    const dir = path.join(tmpdir(), `rules-nopat-${randomUUID()}`);
    const mgr = new CustomRulesManager(dir);

    const rule = makeRule({ id: 'nopat' });
    (rule as any).pattern = '';

    await assert.rejects(
      () => mgr.saveRules([rule]),
      /Invalid rules/,
    );

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('10. rejects invalid regex pattern', async () => {
    const dir = path.join(tmpdir(), `rules-badrx-${randomUUID()}`);
    const mgr = new CustomRulesManager(dir);

    await assert.rejects(
      () => mgr.saveRules([makeRule({ id: 'badrx', pattern: '(?P<invalid' })]),
      /Invalid rules/,
    );

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('11. rejects description over 200 chars', async () => {
    const dir = path.join(tmpdir(), `rules-longdesc-${randomUUID()}`);
    const mgr = new CustomRulesManager(dir);

    await assert.rejects(
      () => mgr.saveRules([makeRule({ id: 'longdesc', description: 'x'.repeat(201) })]),
      /Invalid rules/,
    );

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('12. rejects risk_weight outside 1-25', async () => {
    const dir = path.join(tmpdir(), `rules-badwt-${randomUUID()}`);
    const mgr = new CustomRulesManager(dir);

    await assert.rejects(
      () => mgr.saveRules([makeRule({ id: 'badwt', risk_weight: 30 })]),
      /Invalid rules/,
    );

    await fs.rm(dir, { recursive: true, force: true });
  });

  // ─── Hard Cap ─────────────────────────────────────────────────────────

  it('13. rejects more than 25 rules', async () => {
    const dir = path.join(tmpdir(), `rules-cap-${randomUUID()}`);
    const mgr = new CustomRulesManager(dir);

    const rules = Array.from({ length: 26 }, (_, i) =>
      makeRule({ id: `rule${String(i).padStart(2, '0')}` }),
    );

    await assert.rejects(
      () => mgr.saveRules(rules),
      /Maximum 25 rules allowed/,
    );

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('14. accepts exactly 25 rules', async () => {
    const dir = path.join(tmpdir(), `rules-max-${randomUUID()}`);
    const mgr = new CustomRulesManager(dir);

    const rules = Array.from({ length: 25 }, (_, i) =>
      makeRule({ id: `r${String(i).padStart(3, '0')}` }),
    );

    const result = await mgr.saveRules(rules);
    assert.equal(result.saved_count, 25);

    await fs.rm(dir, { recursive: true });
  });

  // ─── Error reporting ──────────────────────────────────────────────────

  it('15. collects all validation errors in batch', async () => {
    const dir = path.join(tmpdir(), `rules-batch-${randomUUID()}`);
    const mgr = new CustomRulesManager(dir);

    const rules = [
      makeRule({ id: '1bad' }),          // invalid ID (starts with number)
      makeRule({ id: 'ok', pattern: '(' }), // invalid regex
    ];

    try {
      await mgr.saveRules(rules);
      assert.fail('Should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      assert.ok(msg.includes('1bad'), 'error should mention first bad rule');
      assert.ok(msg.includes('ok'), 'error should mention second bad rule');
    }

    await fs.rm(dir, { recursive: true, force: true });
  });

  // ─── Security regression: atomic write (CodeQL js/insecure-temporary-file) ──

  it('16. saveRules writes atomically — no partial files on disk during write', async () => {
    const dir = path.join(tmpdir(), `rules-atomic-${randomUUID()}`);
    const mgr = new CustomRulesManager(dir);
    const rules = [makeRule({ id: 'atomic_test' })];

    await mgr.saveRules(rules);

    // Verify the final file exists and no .tmp- files remain
    const filePath = path.join(dir, 'custom-rules.json');
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    assert.equal(parsed.rules.length, 1);
    assert.equal(parsed.rules[0].id, 'atomic_test');

    // Ensure no leftover temp files
    const files = await fs.readdir(dir);
    const tmpFiles = files.filter(f => f.includes('.tmp-'));
    assert.equal(tmpFiles.length, 0, 'No temp files should remain after atomic write');

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('17. saveRules sets restrictive file permissions on POSIX', async () => {
    if (platform() === 'win32') return; // skip on Windows
    const dir = path.join(tmpdir(), `rules-perms-${randomUUID()}`);
    const mgr = new CustomRulesManager(dir);
    await mgr.saveRules([makeRule({ id: 'perms_test' })]);

    const filePath = path.join(dir, 'custom-rules.json');
    const stat = await fs.stat(filePath);
    // Mode should be 0o600 (owner read/write only) — mask with 0o777 to get permission bits
    const mode = stat.mode & 0o777;
    assert.equal(mode, 0o600, `File permissions should be 600, got ${mode.toString(8)}`);

    await fs.rm(dir, { recursive: true, force: true });
  });
});
