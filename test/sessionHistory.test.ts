// test/sessionHistory.test.ts — 25 high-signal tests for session persistence (v3.2.1)

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SessionHistoryManager } from '../src/sessionHistory.js';
import type { Session, OutputTarget } from '../src/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockSession(overrides?: Partial<Session>): Session {
  const id = randomUUID();
  return {
    id,
    state: 'COMPILED',
    created_at: Date.now(),
    last_accessed: Date.now(),
    raw_prompt: 'Write a function to calculate Fibonacci',
    target: 'claude' as OutputTarget,
    intent_spec: {
      user_intent: 'Write a function',
      goal: 'Create Fibonacci',
      definition_of_done: ['Works for n=10', 'No infinite loops'],
      task_type: 'code_change',
      inputs_detected: [],
      constraints: { scope: [], forbidden: [] },
      output_format: 'JavaScript function',
      risk_level: 'low',
      assumptions: [],
      blocking_questions: [],
    },
    compiled_prompt: 'Write a Fibonacci function...',
    quality_before: { total: 75, max: 100, dimensions: [] },
    compilation_checklist: { items: [], summary: 'Good' },
    cost_estimate: {
      input_tokens: 100,
      estimated_output_tokens: 150,
      costs: [],
      recommended_model: 'claude-opus',
      recommendation_reason: 'Best quality for this task',
    },
    answers: {},
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('sessionHistory', async (t) => {
  await t.test('1. saveSession: saves session to session-{id}.json', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);
    const session = createMockSession();

    const saved = await mgr.saveSession(session);
    assert.equal(saved, true);

    const expectedPath = path.join(tempDir, `session-${session.id}.json`);
    const exists = await fs.stat(expectedPath).then(() => true).catch(() => false);
    assert.equal(exists, true);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('2. loadSession: retrieves session by ID', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);
    const session = createMockSession();

    await mgr.saveSession(session);
    const loaded = await mgr.loadSession(session.id);

    assert.ok(loaded);
    assert.equal(loaded?.id, session.id);
    assert.equal(loaded?.raw_prompt, session.raw_prompt);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('3. loadSession: returns null for non-existent session', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);
    const loaded = await mgr.loadSession('nonexistent-id');
    assert.equal(loaded, null);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('4. listSessions: returns all sessions (newest first)', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);

    const s1 = createMockSession({ created_at: Date.now() - 2000 });
    const s2 = createMockSession({ created_at: Date.now() });
    const s3 = createMockSession({ created_at: Date.now() - 1000 });

    await mgr.saveSession(s1);
    await mgr.saveSession(s2);
    await mgr.saveSession(s3);

    const list = await mgr.listSessions();

    assert.equal(list.schema_version, 1);
    assert.equal(list.sessions.length, 3);
    assert.equal(list.total_sessions, 3);
    // Newest first
    assert.equal(list.sessions[0].session_id, s2.id);
    assert.equal(list.sessions[1].session_id, s3.id);
    assert.equal(list.sessions[2].session_id, s1.id);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('5. listSessions: no raw_prompt in response', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);
    const session = createMockSession({ raw_prompt: 'Secret data' });

    await mgr.saveSession(session);
    const list = await mgr.listSessions();

    assert.equal(list.sessions.length, 1);
    const record = list.sessions[0];
    assert.ok('prompt_hash' in record);
    assert.ok(!('raw_prompt' in record));
    assert.ok(!JSON.stringify(record).toLowerCase().includes('secret'));

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('6. listSessions: respects createdAfter filter', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);
    const base = Date.now();

    const old = createMockSession({ created_at: base - 5000 });
    const recent = createMockSession({ created_at: base });

    await mgr.saveSession(old);
    await mgr.saveSession(recent);

    const list = await mgr.listSessions({ createdAfter: base - 2000 });

    assert.equal(list.sessions.length, 1);
    assert.equal(list.sessions[0].session_id, recent.id);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('7. listSessions: respects createdBefore filter', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);
    const base = Date.now();

    const old = createMockSession({ created_at: base - 5000 });
    const recent = createMockSession({ created_at: base });

    await mgr.saveSession(old);
    await mgr.saveSession(recent);

    const list = await mgr.listSessions({ createdBefore: base - 2000 });

    assert.equal(list.sessions.length, 1);
    assert.equal(list.sessions[0].session_id, old.id);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('8. listSessions: enforces limit (max 100)', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);

    for (let i = 0; i < 105; i++) {
      const s = createMockSession({ created_at: Date.now() - i * 100 });
      await mgr.saveSession(s);
    }

    const list = await mgr.listSessions({ limit: 150 });

    assert.equal(list.sessions.length, 100);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('9. listSessions: returns storage_path', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);
    const list = await mgr.listSessions();

    assert.equal(list.storage_path, tempDir);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('10. exportSession: returns full session with raw prompt', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);
    const session = createMockSession({ raw_prompt: 'Export test' });

    await mgr.saveSession(session);
    const exported = await mgr.exportSession(session.id, 'hash-123', '3.2.1');

    assert.ok(exported);
    assert.equal(exported?.schema_version, 1);
    assert.equal(exported?.raw_prompt, 'Export test');
    assert.equal(exported?.rule_set_hash, 'hash-123');
    assert.equal(exported?.rule_set_version, '3.2.1');

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('11. exportSession: includes metadata fields', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);
    const session = createMockSession();

    await mgr.saveSession(session);
    const exported = await mgr.exportSession(session.id);

    assert.ok(exported?.metadata);
    assert.ok('target' in exported.metadata);
    assert.ok('task_type' in exported.metadata);
    assert.ok('complexity' in exported.metadata);
    assert.ok('risk_score' in exported.metadata);
    assert.ok('custom_rules_applied' in exported.metadata);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('12. exportSession: returns null for non-existent', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);
    const exported = await mgr.exportSession('nonexistent');

    assert.equal(exported, null);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('13. deleteSession: removes session file', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);
    const session = createMockSession();

    await mgr.saveSession(session);
    const deleted = await mgr.deleteSession(session.id);
    assert.equal(deleted, true);

    const loaded = await mgr.loadSession(session.id);
    assert.equal(loaded, null);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('14. deleteSession: returns false for non-existent', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);
    const deleted = await mgr.deleteSession('nonexistent');

    assert.equal(deleted, false);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('15. prompt_hash: is consistent', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);
    const session = createMockSession({ raw_prompt: 'Consistent hash test' });

    await mgr.saveSession(session);
    const list1 = await mgr.listSessions();
    const list2 = await mgr.listSessions();

    assert.equal(list1.sessions[0].prompt_hash, list2.sessions[0].prompt_hash);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('16. prompt_hash: differs for different prompts', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);

    const s1 = createMockSession({ raw_prompt: 'Prompt A' });
    const s2 = createMockSession({ raw_prompt: 'Prompt B' });

    await mgr.saveSession(s1);
    await mgr.saveSession(s2);

    const list = await mgr.listSessions();

    const hashes = list.sessions.map((s: any) => s.prompt_hash);
    assert.notEqual(hashes[0], hashes[1]);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('17. listSessions: includes required fields', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);
    const session = createMockSession();

    await mgr.saveSession(session);
    const list = await mgr.listSessions();

    const record = list.sessions[0];
    assert.ok(record.schema_version);
    assert.ok(record.session_id);
    assert.ok(record.created_at);
    assert.ok(record.state);
    assert.ok(record.task_type);
    assert.ok(typeof record.quality_before === 'number');
    assert.ok(record.prompt_hash);
    assert.ok(typeof record.prompt_length === 'number');
    assert.ok(record.target);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('18. listSessions: handles empty directory', async () => {
    const tempDir = path.join(tmpdir(), `empty-session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);
    const list = await mgr.listSessions();

    assert.equal(list.schema_version, 1);
    assert.equal(list.sessions.length, 0);
    assert.equal(list.total_sessions, 0);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('19. sanitizeSessionId: handles valid IDs', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);
    const session = createMockSession({ id: 'valid-id-123' });
    const saved = await mgr.saveSession(session);
    assert.equal(saved, true);

    const expectedPath = path.join(tempDir, 'session-valid-id-123.json');
    const exists = await fs.stat(expectedPath).then(() => true).catch(() => false);
    assert.equal(exists, true);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('20. prompt_length: is accurate', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);

    const prompt = 'This is a test prompt with 45 characters!!!';
    const session = createMockSession({ raw_prompt: prompt });

    await mgr.saveSession(session);
    const list = await mgr.listSessions();

    assert.equal(list.sessions[0].prompt_length, prompt.length);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('21. quality_after: undefined when not APPROVED', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);

    const session = createMockSession({ state: 'ANALYZING' });
    await mgr.saveSession(session);

    const list = await mgr.listSessions();
    assert.equal(list.sessions[0].quality_after, undefined);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('22. No schema_version in tools: tools are schema-aware', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);
    const session = createMockSession();

    await mgr.saveSession(session);
    const exported = await mgr.exportSession(session.id);

    // Verify Infinity never serialized (acceptance check)
    const json = JSON.stringify(exported);
    assert.ok(!json.includes('Infinity'));

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('23. Concurrent saves: no corruption', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);

    const promises = Array.from({ length: 10 }, (_, i) =>
      mgr.saveSession(createMockSession({ id: `concurrent-${i}` })),
    );

    const results = await Promise.all(promises);
    assert.ok(results.every((r: any) => r === true));

    const list = await mgr.listSessions();
    assert.equal(list.sessions.length, 10);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('24. Read-only: listSessions does not mutate', async () => {
    const tempDir = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const mgr = new SessionHistoryManager(tempDir);
    const session = createMockSession();

    await mgr.saveSession(session);
    const list1 = await mgr.listSessions();
    const list2 = await mgr.listSessions();

    assert.deepEqual(list1.sessions, list2.sessions);

    await fs.rm(tempDir, { recursive: true });
  });

  await t.test('25. Multiple instances: isolation', async () => {
    const tempDir1 = path.join(tmpdir(), `session-test-${randomUUID()}`);
    const tempDir2 = path.join(tmpdir(), `session-test-${randomUUID()}`);
    await fs.mkdir(tempDir1, { recursive: true });
    await fs.mkdir(tempDir2, { recursive: true });

    const mgr1 = new SessionHistoryManager(tempDir1);
    const mgr2 = new SessionHistoryManager(tempDir2);

    const s1 = createMockSession();
    const s2 = createMockSession();

    await mgr1.saveSession(s1);
    await mgr2.saveSession(s2);

    const list1 = await mgr1.listSessions();
    const list2 = await mgr2.listSessions();

    assert.equal(list1.sessions.length, 1);
    assert.equal(list2.sessions.length, 1);
    assert.notEqual(list1.sessions[0].session_id, list2.sessions[0].session_id);

    await fs.rm(tempDir1, { recursive: true });
    await fs.rm(tempDir2, { recursive: true });
  });
});
