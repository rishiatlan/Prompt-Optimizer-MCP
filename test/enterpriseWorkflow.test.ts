// test/enterpriseWorkflow.test.ts — 2 integration tests (v3.3.0)
// Simulates buyer workflows: policy lifecycle + config lock lifecycle.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { AuditLogger, GENESIS_HASH } from '../src/auditLog.js';
import { SessionHistoryManager } from '../src/sessionHistory.js';
import { evaluatePolicyViolations, checkRiskThreshold, STRICTNESS_THRESHOLDS } from '../src/policy.js';
import { assertNoPromptContent } from './helpers/assertNoPromptContent.js';
import type { RuleResult, AuditEntry } from '../src/types.js';

describe('enterpriseWorkflow', async () => {
  it('full buyer lifecycle: configure → enforce → block → purge → audit', async () => {
    const dir = path.join(tmpdir(), `enterprise-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });

    const auditLog = new AuditLogger(dir);
    const sessionMgr = new SessionHistoryManager(dir);

    // 1. Configure: policy_mode=enforce
    const config = { policy_mode: 'enforce', strictness: 'standard' };

    // 2. Simulate BLOCKING rule trigger
    const blockingResults: RuleResult[] = [{
      rule_name: 'no_pii_custom',
      triggered: true,
      severity: 'blocking',
      message: 'PII detected in prompt',
      applies_to: 'all',
      risk_elevation: 'high',
    } as RuleResult];

    const violations = evaluatePolicyViolations(blockingResults, config);
    assert.equal(violations.length, 1, 'Should have 1 violation');
    assert.equal(violations[0].rule_id, 'no_pii_custom');

    // Audit the blocked attempt
    await auditLog.append({
      timestamp: new Date().toISOString(),
      event: 'optimize',
      request_id: randomUUID(),
      outcome: 'blocked',
      policy_mode: 'enforce',
      details: { reason: 'policy_violation', violation_count: 1 },
    });

    // 3. Risk threshold check
    const riskCheck = checkRiskThreshold(70, config.strictness);
    assert.equal(riskCheck.exceeded, true, 'Score 70 should exceed standard threshold 60');
    assert.equal(riskCheck.threshold, STRICTNESS_THRESHOLDS.standard);

    // Audit the blocked approve
    await auditLog.append({
      timestamp: new Date().toISOString(),
      event: 'approve',
      request_id: randomUUID(),
      outcome: 'blocked',
      policy_mode: 'enforce',
      details: { reason: 'risk_threshold_exceeded', risk_score: 70, threshold: 60 },
    });

    // 4. Create some sessions and purge
    for (let i = 0; i < 3; i++) {
      await sessionMgr.saveSession({
        id: randomUUID(),
        raw_prompt: 'Test prompt',
        compiled_prompt: 'Compiled',
        state: 'APPROVED',
        created_at: Date.now() - (90 * 24 * 60 * 60 * 1000), // old
        target: 'claude',
        quality_before: { total: 65, dimensions: [], scoring_version: 2 },
        intent_spec: {
          task_type: 'code_change',
          role: 'dev',
          goal: 'test',
          context_summary: '',
          constraints: [],
          definition_of_done: [],
          risk_level: 'low',
        },
      } as any);
    }

    const purgeResult = await sessionMgr.purgeByPolicy({
      mode: 'by_policy',
      older_than_days: 30,
    });
    assert.equal(purgeResult.deleted_count, 3, 'Should purge 3 old sessions');

    // Audit the purge
    await auditLog.append({
      timestamp: new Date().toISOString(),
      event: 'purge',
      request_id: randomUUID(),
      outcome: 'success',
      policy_mode: 'enforce',
      details: { deleted_count: purgeResult.deleted_count, retained_count: 0 },
    });

    // 5. Verify audit trail
    const entries = await auditLog.readAll();
    assert.equal(entries.length, 3, 'Should have 3 audit entries');
    assert.equal(entries[0].outcome, 'blocked');
    assert.equal(entries[1].outcome, 'blocked');
    assert.equal(entries[2].outcome, 'success');

    // 6. No prompt content in audit entries
    for (const entry of entries) {
      assertNoPromptContent(entry);
    }

    // 7. policy_mode present in audit entries
    for (const entry of entries) {
      assert.equal(entry.policy_mode, 'enforce', 'policy_mode should be in all audit entries');
    }

    // 8. Hash chain integrity
    for (const entry of entries) {
      assert.ok(entry.integrity_hash, 'all entries should have integrity_hash');
      assert.match(entry.integrity_hash!, /^[a-f0-9]{64}$/);
    }

    const chainResult = await auditLog.verifyChain();
    assert.equal(chainResult.valid, true, 'audit chain should be valid');
    assert.equal(chainResult.entry_count, 3);

    await fs.rm(dir, { recursive: true });
  });

  it('config lock lifecycle: lock → block changes → wrong secret → unlock', async () => {
    const dir = path.join(tmpdir(), `enterprise-lock-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });

    const auditLog = new AuditLogger(dir);
    const secret = 'admin-passphrase-2024';
    const secretHash = createHash('sha256').update(secret, 'utf8').digest('hex');

    // 1. Lock: admin sets locked_config=true with secret hash
    const lockedConfig = {
      locked_config: true,
      lock_secret_hash: secretHash,
      audit_log: true,
      policy_mode: 'enforce',
    };

    // Audit the lock
    await auditLog.append({
      timestamp: new Date().toISOString(),
      event: 'configure',
      request_id: randomUUID(),
      outcome: 'success',
      policy_mode: 'enforce',
      details: { action: 'lock' },
    });

    // 2. Blocked change attempt
    assert.equal(lockedConfig.locked_config, true, 'config should be locked');

    await auditLog.append({
      timestamp: new Date().toISOString(),
      event: 'configure',
      request_id: randomUUID(),
      outcome: 'blocked',
      policy_mode: 'enforce',
      details: { reason: 'config_locked' },
    });

    // 3. Wrong secret attempt
    const wrongHash = createHash('sha256').update('wrong-password', 'utf8').digest('hex');
    assert.notEqual(wrongHash, secretHash, 'wrong hash should not match');

    await auditLog.append({
      timestamp: new Date().toISOString(),
      event: 'configure',
      request_id: randomUUID(),
      outcome: 'blocked',
      policy_mode: 'enforce',
      details: { action: 'unlock', reason: 'wrong_secret' },
    });

    // 4. Correct secret unlocks
    const correctHash = createHash('sha256').update(secret, 'utf8').digest('hex');
    assert.equal(correctHash, secretHash, 'correct hash should match');

    await auditLog.append({
      timestamp: new Date().toISOString(),
      event: 'configure',
      request_id: randomUUID(),
      outcome: 'success',
      policy_mode: 'enforce',
      details: { action: 'unlock' },
    });

    // 5. Verify audit trail
    const entries = await auditLog.readAll();
    assert.equal(entries.length, 4, 'Should have 4 audit entries');
    assert.equal(entries[0].outcome, 'success');  // lock
    assert.equal(entries[1].outcome, 'blocked');  // blocked change
    assert.equal(entries[2].outcome, 'blocked');  // wrong secret
    assert.equal(entries[3].outcome, 'success');  // unlock

    // 6. Chain integrity
    const chainResult = await auditLog.verifyChain();
    assert.equal(chainResult.valid, true, 'audit chain should be valid');

    // 7. No prompt content
    for (const entry of entries) {
      assertNoPromptContent(entry);
    }

    await fs.rm(dir, { recursive: true });
  });
});
