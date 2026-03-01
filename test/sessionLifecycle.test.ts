// test/sessionLifecycle.test.ts — 15 tests for delete + purge lifecycle (v3.3.0)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SessionHistoryManager } from '../src/sessionHistory.js';
import type { Session } from '../src/types.js';

function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: randomUUID(),
    raw_prompt: 'Test prompt for lifecycle testing',
    compiled_prompt: 'Compiled test prompt',
    state: 'APPROVED',
    created_at: Date.now(),
    target: 'claude' as const,
    quality_before: { total: 65, dimensions: [], scoring_version: 2 },
    intent_spec: {
      task_type: 'code_change',
      role: 'developer',
      goal: 'test',
      context_summary: '',
      constraints: [],
      definition_of_done: [],
      risk_level: 'low',
    },
    ...overrides,
  } as Session;
}

describe('sessionLifecycle', async () => {
  // ─── deleteSession ────────────────────────────────────────────────────────

  it('1. deleteSession: returns true for existing session', async () => {
    const dir = path.join(tmpdir(), `lifecycle-${randomUUID()}`);
    const mgr = new SessionHistoryManager(dir);

    const session = createMockSession();
    await mgr.saveSession(session);
    const result = await mgr.deleteSession(session.id);
    assert.equal(result, true);

    await fs.rm(dir, { recursive: true });
  });

  it('2. deleteSession: returns false for missing session', async () => {
    const dir = path.join(tmpdir(), `lifecycle-${randomUUID()}`);
    const mgr = new SessionHistoryManager(dir);
    await fs.mkdir(dir, { recursive: true });

    const result = await mgr.deleteSession('nonexistent-id');
    assert.equal(result, false);

    await fs.rm(dir, { recursive: true });
  });

  it('3. deleteSession: idempotent (second delete returns false)', async () => {
    const dir = path.join(tmpdir(), `lifecycle-${randomUUID()}`);
    const mgr = new SessionHistoryManager(dir);

    const session = createMockSession();
    await mgr.saveSession(session);
    assert.equal(await mgr.deleteSession(session.id), true);
    assert.equal(await mgr.deleteSession(session.id), false);

    await fs.rm(dir, { recursive: true });
  });

  it('4. deleteSession: file actually removed from disk', async () => {
    const dir = path.join(tmpdir(), `lifecycle-${randomUUID()}`);
    const mgr = new SessionHistoryManager(dir);

    const session = createMockSession();
    await mgr.saveSession(session);
    await mgr.deleteSession(session.id);

    const loaded = await mgr.loadSession(session.id);
    assert.equal(loaded, null);

    await fs.rm(dir, { recursive: true });
  });

  // ─── purgeByPolicy ────────────────────────────────────────────────────────

  it('5. purgeByPolicy: no-op when no params provided (mode=by_policy, no older_than_days)', async () => {
    const dir = path.join(tmpdir(), `lifecycle-${randomUUID()}`);
    const mgr = new SessionHistoryManager(dir);

    const session = createMockSession();
    await mgr.saveSession(session);

    const result = await mgr.purgeByPolicy({ mode: 'by_policy' });
    assert.equal(result.no_op, true);
    assert.equal(result.deleted_count, 0);

    await fs.rm(dir, { recursive: true });
  });

  it('6. purgeByPolicy: purge_all (mode=all) deletes everything', async () => {
    const dir = path.join(tmpdir(), `lifecycle-${randomUUID()}`);
    const mgr = new SessionHistoryManager(dir);

    for (let i = 0; i < 3; i++) {
      await mgr.saveSession(createMockSession());
    }

    const result = await mgr.purgeByPolicy({ mode: 'all' });
    assert.equal(result.deleted_count, 3);
    assert.equal(result.retained_count, 0);

    await fs.rm(dir, { recursive: true });
  });

  it('7. purgeByPolicy: older_than_days filters correctly', async () => {
    const dir = path.join(tmpdir(), `lifecycle-${randomUUID()}`);
    const mgr = new SessionHistoryManager(dir);
    const now = Date.now();

    // Old session (60 days ago)
    await mgr.saveSession(createMockSession({ created_at: now - (60 * 24 * 60 * 60 * 1000) }));
    // Recent session (1 day ago)
    await mgr.saveSession(createMockSession({ created_at: now - (1 * 24 * 60 * 60 * 1000) }));

    const result = await mgr.purgeByPolicy({ mode: 'by_policy', older_than_days: 30 });
    assert.equal(result.deleted_count, 1);
    assert.equal(result.retained_count, 1);

    await fs.rm(dir, { recursive: true });
  });

  it('8. purgeByPolicy: keep_last preserves newest N', async () => {
    const dir = path.join(tmpdir(), `lifecycle-${randomUUID()}`);
    const mgr = new SessionHistoryManager(dir);
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      await mgr.saveSession(createMockSession({ created_at: now - (i * 1000) }));
    }

    const result = await mgr.purgeByPolicy({ mode: 'all', keep_last: 2 });
    assert.equal(result.deleted_count, 3);
    assert.equal(result.retained_count, 2);

    await fs.rm(dir, { recursive: true });
  });

  it('9. purgeByPolicy: both filters combined (age + keep_last)', async () => {
    const dir = path.join(tmpdir(), `lifecycle-${randomUUID()}`);
    const mgr = new SessionHistoryManager(dir);
    const now = Date.now();

    // 3 old (60 days), 2 recent (1 day)
    for (let i = 0; i < 3; i++) {
      await mgr.saveSession(createMockSession({ created_at: now - (60 * 24 * 60 * 60 * 1000) + i }));
    }
    for (let i = 0; i < 2; i++) {
      await mgr.saveSession(createMockSession({ created_at: now - (1 * 24 * 60 * 60 * 1000) + i }));
    }

    const result = await mgr.purgeByPolicy({ mode: 'by_policy', older_than_days: 30, keep_last: 1 });
    // 3 old qualify for deletion, but keep_last=1 protects newest globally
    // Newest is a recent one, so all 3 old should be deleted
    assert.equal(result.deleted_count, 3);

    await fs.rm(dir, { recursive: true });
  });

  it('10. purgeByPolicy: empty dir returns no-op', async () => {
    const dir = path.join(tmpdir(), `lifecycle-${randomUUID()}`);
    const mgr = new SessionHistoryManager(dir);
    await fs.mkdir(dir, { recursive: true });

    const result = await mgr.purgeByPolicy({ mode: 'all' });
    assert.equal(result.no_op, true);
    assert.equal(result.scanned_count, 0);

    await fs.rm(dir, { recursive: true });
  });

  it('11. purgeByPolicy: dry_run does not delete files', async () => {
    const dir = path.join(tmpdir(), `lifecycle-${randomUUID()}`);
    const mgr = new SessionHistoryManager(dir);

    const session = createMockSession();
    await mgr.saveSession(session);

    const result = await mgr.purgeByPolicy({ mode: 'all', dry_run: true });
    assert.equal(result.deleted_count, 1); // would delete
    assert.equal(result.dry_run, true);

    // File still exists
    const loaded = await mgr.loadSession(session.id);
    assert.ok(loaded, 'session should still exist after dry_run');

    await fs.rm(dir, { recursive: true });
  });

  it('12. purgeByPolicy: correct counts returned', async () => {
    const dir = path.join(tmpdir(), `lifecycle-${randomUUID()}`);
    const mgr = new SessionHistoryManager(dir);

    for (let i = 0; i < 4; i++) {
      await mgr.saveSession(createMockSession());
    }

    const result = await mgr.purgeByPolicy({ mode: 'all', keep_last: 1 });
    assert.equal(result.scanned_count, 4);
    assert.equal(result.deleted_count, 3);
    assert.equal(result.retained_count, 1);
    assert.equal(result.deleted_session_ids.length, 3);

    await fs.rm(dir, { recursive: true });
  });

  it('13. purgeByPolicy: deleted_session_ids always sorted lexicographic', async () => {
    const dir = path.join(tmpdir(), `lifecycle-${randomUUID()}`);
    const mgr = new SessionHistoryManager(dir);

    for (let i = 0; i < 5; i++) {
      await mgr.saveSession(createMockSession());
    }

    const result = await mgr.purgeByPolicy({ mode: 'all' });
    const ids = result.deleted_session_ids;
    const sorted = [...ids].sort();
    assert.deepEqual(ids, sorted, 'deleted_session_ids should be sorted lexicographic');

    await fs.rm(dir, { recursive: true });
  });

  it('14. purgeByPolicy: only deletes session-*.json — does NOT touch other files', async () => {
    const dir = path.join(tmpdir(), `lifecycle-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });

    // Create non-session files that must survive purge
    const protectedFiles = ['audit.log', 'config.json', 'usage.json', 'license.json', 'custom-rules.json'];
    for (const file of protectedFiles) {
      await fs.writeFile(path.join(dir, file), '{}', 'utf8');
    }

    const mgr = new SessionHistoryManager(dir);
    await mgr.saveSession(createMockSession());
    await mgr.saveSession(createMockSession());

    await mgr.purgeByPolicy({ mode: 'all' });

    // All protected files should still exist
    for (const file of protectedFiles) {
      const exists = await fs.stat(path.join(dir, file)).then(() => true).catch(() => false);
      assert.ok(exists, `${file} should NOT be deleted by purge`);
    }

    await fs.rm(dir, { recursive: true });
  });

  it('15. purgeByPolicy: keep_last protects even when all sessions old', async () => {
    const dir = path.join(tmpdir(), `lifecycle-${randomUUID()}`);
    const mgr = new SessionHistoryManager(dir);
    const now = Date.now();

    // All sessions are old (90 days)
    for (let i = 0; i < 3; i++) {
      await mgr.saveSession(createMockSession({ created_at: now - (90 * 24 * 60 * 60 * 1000) + i }));
    }

    const result = await mgr.purgeByPolicy({ mode: 'by_policy', older_than_days: 30, keep_last: 2 });
    assert.equal(result.deleted_count, 1, 'should delete only 1 (keep_last=2 protects 2 newest)');
    assert.equal(result.retained_count, 2);

    await fs.rm(dir, { recursive: true });
  });
});
