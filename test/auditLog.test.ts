// test/auditLog.test.ts — 18 tests for AuditLogger (v3.3.0)
// Covers: JSONL write, hash chaining, chain verification, no-throw, privacy
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { AuditLogger, GENESIS_HASH } from '../src/auditLog.js';
import type { AuditEntry } from '../src/types.js';
import { assertNoPromptContent } from './helpers/assertNoPromptContent.js';

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    event: 'optimize',
    request_id: randomUUID(),
    outcome: 'success',
    ...overrides,
  };
}

describe('AuditLogger', async () => {
  it('1. appends JSONL line to audit.log', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-test-'));
    const logger = new AuditLogger(dir);
    await logger.append(makeEntry());

    const data = await fs.readFile(path.join(dir, 'audit.log'), 'utf8');
    const lines = data.trim().split('\n');
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.event, 'optimize');

    await fs.rm(dir, { recursive: true });
  });

  it('2. appends multiple entries as separate JSONL lines', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-test-'));
    const logger = new AuditLogger(dir);
    await logger.append(makeEntry({ event: 'optimize' }));
    await logger.append(makeEntry({ event: 'approve' }));
    await logger.append(makeEntry({ event: 'delete' }));

    const data = await fs.readFile(path.join(dir, 'audit.log'), 'utf8');
    const lines = data.trim().split('\n');
    assert.equal(lines.length, 3);
    assert.equal(JSON.parse(lines[0]).event, 'optimize');
    assert.equal(JSON.parse(lines[1]).event, 'approve');
    assert.equal(JSON.parse(lines[2]).event, 'delete');

    await fs.rm(dir, { recursive: true });
  });

  it('3. each line is valid JSON with required fields', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-test-'));
    const logger = new AuditLogger(dir);
    const entry = makeEntry({
      session_id: 'sess-123',
      task_type: 'code_change',
      risk_score: 45,
      policy_mode: 'enforce',
    });
    await logger.append(entry);

    const data = await fs.readFile(path.join(dir, 'audit.log'), 'utf8');
    const parsed = JSON.parse(data.trim());
    assert.ok(parsed.timestamp);
    assert.ok(parsed.event);
    assert.ok(parsed.request_id);
    assert.ok(parsed.outcome);

    await fs.rm(dir, { recursive: true });
  });

  it('4. timestamp is ISO 8601 format', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-test-'));
    const logger = new AuditLogger(dir);
    await logger.append(makeEntry());

    const data = await fs.readFile(path.join(dir, 'audit.log'), 'utf8');
    const parsed = JSON.parse(data.trim());
    // ISO 8601: YYYY-MM-DDTHH:mm:ss.sssZ
    assert.match(parsed.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    await fs.rm(dir, { recursive: true });
  });

  it('5. no-throw on write error (invalid path)', async () => {
    const logger = new AuditLogger('/nonexistent/deeply/nested/path');
    // Should not throw — audit never breaks pipeline
    await logger.append(makeEntry());
  });

  it('6. creates directory if missing', async () => {
    const parentDir = mkdtempSync(path.join(tmpdir(), 'audit-test-'));
    const dir = path.join(parentDir, 'nested');
    const logger = new AuditLogger(dir);
    await logger.append(makeEntry());

    const exists = await fs.stat(path.join(dir, 'audit.log')).then(() => true).catch(() => false);
    assert.ok(exists);

    await fs.rm(parentDir, { recursive: true });
  });

  it('7. readAll returns all entries', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-test-'));
    const logger = new AuditLogger(dir);
    await logger.append(makeEntry({ event: 'optimize' }));
    await logger.append(makeEntry({ event: 'approve' }));

    const entries = await logger.readAll();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].event, 'optimize');
    assert.equal(entries[1].event, 'approve');

    await fs.rm(dir, { recursive: true });
  });

  it('8. readAll returns empty for missing file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-test-'));
    const logger = new AuditLogger(dir);

    const entries = await logger.readAll();
    assert.equal(entries.length, 0);
  });

  it('9. details field capped at 10 keys', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-test-'));
    const logger = new AuditLogger(dir);

    const details: Record<string, string> = {};
    for (let i = 0; i < 15; i++) {
      details[`key_${i}`] = `value_${i}`;
    }

    await logger.append(makeEntry({ details }));

    const data = await fs.readFile(path.join(dir, 'audit.log'), 'utf8');
    const parsed = JSON.parse(data.trim());
    const keys = Object.keys(parsed.details || {});
    assert.ok(keys.length <= 10, `details should have at most 10 keys, got ${keys.length}`);

    await fs.rm(dir, { recursive: true });
  });

  it('10. audit entries never contain prompt content', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-test-'));
    const logger = new AuditLogger(dir);
    await logger.append(makeEntry({
      task_type: 'code_change',
      risk_score: 30,
      details: { dry_run: true, deleted_count: 5 },
    }));

    const entries = await logger.readAll();
    for (const entry of entries) {
      assertNoPromptContent(entry);
    }

    await fs.rm(dir, { recursive: true });
  });

  it('11. AuditEntry shape has all required fields', () => {
    const entry = makeEntry();
    assert.ok('timestamp' in entry);
    assert.ok('event' in entry);
    assert.ok('request_id' in entry);
    assert.ok('outcome' in entry);
  });

  it('12. details values typed as string | number | boolean', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-test-'));
    const logger = new AuditLogger(dir);
    await logger.append(makeEntry({
      details: { str: 'hello', num: 42, bool: true },
    }));

    const entries = await logger.readAll();
    const details = entries[0].details!;
    assert.equal(typeof details.str, 'string');
    assert.equal(typeof details.num, 'number');
    assert.equal(typeof details.bool, 'boolean');

    await fs.rm(dir, { recursive: true });
  });

  // ─── Hash Chaining Tests ──────────────────────────────────────────────────

  it('13. first entry chains from GENESIS_HASH', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-test-'));
    const logger = new AuditLogger(dir);
    await logger.append(makeEntry());

    const entries = await logger.readAll();
    assert.ok(entries[0].integrity_hash, 'first entry should have integrity_hash');
    assert.match(entries[0].integrity_hash!, /^[a-f0-9]{64}$/, 'should be SHA-256 hex');

    // Verify it's hash(GENESIS + JSON(entry_without_hash))
    const { integrity_hash, ...entryWithoutHash } = entries[0];
    const expected = createHash('sha256')
      .update(GENESIS_HASH + JSON.stringify(entryWithoutHash), 'utf8')
      .digest('hex');
    assert.equal(integrity_hash, expected);

    await fs.rm(dir, { recursive: true });
  });

  it('14. second entry chains from first entry hash', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-test-'));
    const logger = new AuditLogger(dir);
    await logger.append(makeEntry({ event: 'optimize' }));
    await logger.append(makeEntry({ event: 'approve' }));

    const entries = await logger.readAll();
    assert.ok(entries[0].integrity_hash);
    assert.ok(entries[1].integrity_hash);
    assert.notEqual(entries[0].integrity_hash, entries[1].integrity_hash, 'hashes should differ');

    // Verify chain: entry[1] hash = SHA-256(entry[0].hash + JSON(entry[1] without hash))
    const { integrity_hash: hash1 } = entries[0];
    const { integrity_hash: hash2, ...entry2WithoutHash } = entries[1];
    const expected = createHash('sha256')
      .update(hash1! + JSON.stringify(entry2WithoutHash), 'utf8')
      .digest('hex');
    assert.equal(hash2, expected);

    await fs.rm(dir, { recursive: true });
  });

  it('15. verifyChain returns valid for clean chain', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-test-'));
    const logger = new AuditLogger(dir);
    await logger.append(makeEntry({ event: 'optimize' }));
    await logger.append(makeEntry({ event: 'approve' }));
    await logger.append(makeEntry({ event: 'delete' }));

    const result = await logger.verifyChain();
    assert.equal(result.valid, true);
    assert.equal(result.entry_count, 3);

    await fs.rm(dir, { recursive: true });
  });

  it('16. verifyChain detects tampered entry', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-test-'));
    const logger = new AuditLogger(dir);
    await logger.append(makeEntry({ event: 'optimize' }));
    await logger.append(makeEntry({ event: 'approve' }));
    await logger.append(makeEntry({ event: 'delete' }));

    // Tamper with the second entry
    const filePath = path.join(dir, 'audit.log');
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.trim().split('\n');
    const tampered = JSON.parse(lines[1]);
    tampered.event = 'purge'; // change the event
    lines[1] = JSON.stringify(tampered);
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8');

    const result = await logger.verifyChain();
    assert.equal(result.valid, false);
    assert.equal(result.broken_at_index, 1, 'should detect break at tampered entry');

    await fs.rm(dir, { recursive: true });
  });

  it('17. verifyChain returns valid for empty log', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-test-'));
    const logger = new AuditLogger(dir);

    const result = await logger.verifyChain();
    assert.equal(result.valid, true);
    assert.equal(result.entry_count, 0);
  });

  it('18. GENESIS_HASH is 64 zero chars', () => {
    assert.equal(GENESIS_HASH.length, 64);
    assert.match(GENESIS_HASH, /^0{64}$/);
  });
});
