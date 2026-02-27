// test/storage.test.ts — Storage layer: defaults, sessions, health, security.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalFsStorage } from '../src/storage/localFs.js';
import type { Session, OptimizerConfig } from '../src/types.js';

// Use a temp directory for each test to isolate state
let testDir: string;
let storage: LocalFsStorage;

function makeTestStorage(): LocalFsStorage {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-test-'));
  return new LocalFsStorage(testDir);
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    state: 'COMPILED',
    created_at: Date.now(),
    last_accessed: Date.now(),
    raw_prompt: 'test prompt',
    target: 'claude',
    intent_spec: {
      user_intent: 'test',
      goal: 'test goal',
      definition_of_done: ['done'],
      task_type: 'other',
      inputs_detected: [],
      constraints: { scope: [], forbidden: [] },
      output_format: 'text',
      risk_level: 'low',
      assumptions: [],
      blocking_questions: [],
    },
    compiled_prompt: '<role>test</role>',
    quality_before: { total: 50, max: 100, dimensions: [] },
    compilation_checklist: { items: [], summary: '0/0' },
    cost_estimate: {
      input_tokens: 100,
      estimated_output_tokens: 50,
      costs: [],
      recommended_model: 'sonnet',
      recommendation_reason: 'test',
    },
    answers: {},
    ...overrides,
  };
}

describe('LocalFsStorage', () => {
  beforeEach(() => {
    storage = makeTestStorage();
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true }); } catch {}
  });

  it('returns default usage for new storage', async () => {
    const usage = await storage.getUsage();
    assert.equal(usage.total_optimizations, 0);
    assert.equal(usage.tier, 'free');
    assert.equal(usage.schema_version, 1);
  });

  it('returns default config for new storage', async () => {
    const config = await storage.getConfig();
    assert.equal(config.mode, 'manual');
    assert.equal(config.threshold, 60);
    assert.equal(config.default_target, 'claude');
    assert.equal(config.ephemeral_mode, false);
    assert.equal(config.max_session_dir_mb, 20);
  });

  it('increments usage and persists', async () => {
    const before = await storage.getUsage();
    assert.equal(before.total_optimizations, 0);

    const after = await storage.incrementUsage();
    assert.equal(after.total_optimizations, 1);
    assert.ok(after.first_used_at.length > 0);
    assert.ok(after.last_used_at.length > 0);

    // Verify persistence
    const reloaded = await storage.getUsage();
    assert.equal(reloaded.total_optimizations, 1);
  });

  it('setConfig merges with defaults', async () => {
    const config = await storage.setConfig({ threshold: 75 });
    assert.equal(config.threshold, 75);
    assert.equal(config.mode, 'manual'); // unchanged

    // Verify persistence
    const reloaded = await storage.getConfig();
    assert.equal(reloaded.threshold, 75);
  });

  it('health returns ok for valid directory', async () => {
    const health = await storage.health();
    assert.equal(health, 'ok');
  });

  it('saves and loads sessions', async () => {
    const session = makeSession();
    await storage.saveSession(session);
    const loaded = await storage.loadSession(session.id);
    assert.ok(loaded, 'Session should be found');
    assert.equal(loaded!.id, session.id);
    assert.equal(loaded!.raw_prompt, 'test prompt');
  });

  it('returns undefined for nonexistent session', async () => {
    const loaded = await storage.loadSession('nonexistent');
    assert.equal(loaded, undefined);
  });

  it('deletes sessions', async () => {
    const session = makeSession();
    await storage.saveSession(session);
    await storage.deleteSession(session.id);
    const loaded = await storage.loadSession(session.id);
    assert.equal(loaded, undefined);
  });

  it('sanitizes session IDs (path traversal prevention)', async () => {
    const loaded = await storage.loadSession('../../../etc/passwd');
    assert.equal(loaded, undefined);
  });

  it('sanitizes session IDs with special chars', async () => {
    const loaded = await storage.loadSession('id_with/slashes/../escape');
    assert.equal(loaded, undefined);
  });

  it('returns default stats for new storage', async () => {
    const stats = await storage.getStats();
    assert.equal(stats.total_optimized, 0);
    assert.equal(stats.scoring_version, 2);
    assert.equal(stats.schema_version, 1);
  });

  it('updateStats increments optimize counter', async () => {
    await storage.updateStats({
      type: 'optimize',
      score_before: 50,
      task_type: 'writing',
      blocking_questions: ['What audience?'],
    });
    const stats = await storage.getStats();
    assert.equal(stats.total_optimized, 1);
    assert.equal(stats.score_sum_before, 50);
    assert.equal(stats.task_type_counts['writing'], 1);
    assert.equal(stats.blocking_question_counts['What audience?'], 1);
  });

  it('updateStats increments approve counter', async () => {
    await storage.updateStats({ type: 'approve' });
    const stats = await storage.getStats();
    assert.equal(stats.total_approved, 1);
  });
});

describe('LocalFsStorage session cleanup', () => {
  beforeEach(() => {
    storage = makeTestStorage();
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true }); } catch {}
  });

  it('enforces max_sessions limit', async () => {
    await storage.setConfig({ max_sessions: 3 });

    for (let i = 0; i < 5; i++) {
      const session = makeSession({ id: `session-${i}` });
      session.created_at = Date.now() + i * 1000; // ensure ordering
      await storage.saveSession(session);
    }

    // After cleanup, only 3 should remain
    const sessionsDir = path.join(testDir, 'sessions');
    const files = fs.readdirSync(sessionsDir);
    assert.ok(files.length <= 3, `Expected <= 3 sessions, got ${files.length}`);
  });
});
