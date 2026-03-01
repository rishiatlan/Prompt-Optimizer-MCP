// sessionHistory.ts — Session persistence, retrieval, and hashing for v3.2.1.
// Stores sessions as session-{id}.json in ~/.prompt-control-plane/
// No auto-purge (manual deletion only).

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { log } from './logger.js';
import { customRules } from './customRules.js';
import { runRules, computeRiskScore, calculateBuiltInRuleSetHash, RULES_VERSION } from './rules.js';
import type {
  Session,
  SessionRecord,
  SessionExport,
  SessionListResponse,
  ReasoningComplexity,
  PurgeResult,
} from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DATA_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.prompt-control-plane',
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function sanitizeSessionId(id: string): string {
  return id.replace(/[^a-zA-Z0-9-]/g, '');
}

// ─── Session History Manager ──────────────────────────────────────────────────

export class SessionHistoryManager {
  private readonly dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || DEFAULT_DATA_DIR;
  }

  /**
   * Save session to disk: ~/.prompt-control-plane/session-{id}.json
   * No throwing — returns success status.
   */
  async saveSession(session: Session): Promise<boolean> {
    try {
      // Ensure directory exists
      await fs.mkdir(this.dataDir, { recursive: true });

      const sessionId = sanitizeSessionId(session.id);
      const sessionPath = path.join(this.dataDir, `session-${sessionId}.json`);

      const data = JSON.stringify(session, null, 2);
      await fs.writeFile(sessionPath, data, 'utf8');

      log.debug('sessionHistory', `Saved session ${sessionId}`);
      return true;
    } catch (err) {
      log.error('sessionHistory', 'saveSession failed:', err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  /**
   * Load session by ID: ~/.prompt-control-plane/session-{id}.json
   */
  async loadSession(sessionId: string): Promise<Session | null> {
    try {
      const sanitized = sanitizeSessionId(sessionId);
      const sessionPath = path.join(this.dataDir, `session-${sanitized}.json`);

      const data = await fs.readFile(sessionPath, 'utf8');
      const session = JSON.parse(data) as Session;

      log.debug('sessionHistory', `Loaded session ${sanitized}`);
      return session;
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
        log.error('sessionHistory', 'loadSession failed:', err.message);
      }
      return null;
    }
  }

  /**
   * List all sessions (metadata only, no raw prompts).
   * Sorted newest-first.
   * Limited to max 100.
   */
  async listSessions(filter?: {
    createdAfter?: number;  // Unix timestamp
    createdBefore?: number; // Unix timestamp
    limit?: number;         // Max 100
  }): Promise<SessionListResponse> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });

      const files = await fs.readdir(this.dataDir);
      const sessionFiles = files.filter((f) => f.startsWith('session-') && f.endsWith('.json'));

      const records: SessionRecord[] = [];

      for (const file of sessionFiles) {
        try {
          const data = await fs.readFile(path.join(this.dataDir, file), 'utf8');
          const session = JSON.parse(data) as Session;

          // Filtering
          if (filter?.createdAfter && session.created_at < filter.createdAfter) continue;
          if (filter?.createdBefore && session.created_at > filter.createdBefore) continue;

          // Create metadata-only record (no raw prompt)
          const record: SessionRecord = {
            schema_version: 1,
            session_id: session.id,
            created_at: session.created_at,
            state: session.state,
            task_type: session.intent_spec.task_type,
            quality_before: session.quality_before.total,
            quality_after: session.state === 'APPROVED' ? session.quality_before.total : undefined,
            prompt_hash: sha256(session.raw_prompt),
            prompt_length: session.raw_prompt.length,
            target: session.target,
          };

          records.push(record);
        } catch (err) {
          log.warn('sessionHistory', `Failed to read ${file}:`, err instanceof Error ? err.message : String(err));
          continue;
        }
      }

      // Sort newest-first
      records.sort((a, b) => b.created_at - a.created_at);

      // Apply limit (max 100)
      const limit = Math.min(filter?.limit || 100, 100);
      const limited = records.slice(0, limit);

      return {
        schema_version: 1,
        sessions: limited,
        total_sessions: records.length,
        storage_path: this.dataDir,
      };
    } catch (err) {
      log.error('sessionHistory', 'listSessions failed:', err instanceof Error ? err.message : String(err));
      return {
        schema_version: 1,
        sessions: [],
        total_sessions: 0,
        storage_path: this.dataDir,
      };
    }
  }

  /**
   * Export full session details (including raw prompt).
   * Returns null if not found.
   */
  async exportSession(sessionId: string, options?: {
    engine_version?: string;
    policy_mode?: string;
    policy_hash?: string;
  }): Promise<SessionExport | null> {
    try {
      const session = await this.loadSession(sessionId);
      if (!session) return null;

      // Infer complexity from available data (simplified)
      const complexity: ReasoningComplexity = session.intent_spec.task_type === 'code_change'
        ? 'analytical'
        : 'simple_factual';

      // Load custom rules and determine which applied to this prompt
      const customRulesList = await customRules.getRulesForTask(session.intent_spec.task_type);
      const customRulesApplied: string[] = [];

      for (const rule of customRulesList) {
        const match = await customRules.evaluateRule(rule, session.raw_prompt, session.intent_spec.task_type);
        if (match?.matched) {
          customRulesApplied.push(rule.id); // Store bare ID, not namespaced
        }
      }

      // Calculate custom rule-set hash (deterministic format)
      const customRuleSetHash = customRules.calculateRuleSetHash(customRulesList);

      // Auto-calculate built-in rule-set hash and version
      const ruleSetHash = calculateBuiltInRuleSetHash();
      const ruleSetVersion = RULES_VERSION;

      // Compute risk score using stored taskType from the session (not re-derived)
      const ruleResults = runRules(session.raw_prompt, undefined, session.intent_spec.task_type);
      const riskScore = computeRiskScore(ruleResults).score;

      return {
        schema_version: 1,
        session_id: session.id,
        created_at: session.created_at,
        state: session.state,
        raw_prompt: session.raw_prompt,
        compiled_prompt: session.compiled_prompt,
        quality_before: session.quality_before.total,
        quality_after: session.state === 'APPROVED' ? session.quality_before.total : undefined,
        rule_set_hash: ruleSetHash,
        rule_set_version: ruleSetVersion,
        metadata: {
          target: session.target,
          task_type: session.intent_spec.task_type,
          complexity,
          risk_score: riskScore,
          custom_rules_applied: customRulesApplied,
          custom_rule_set_hash: customRuleSetHash,
          // v3.3.0: Enterprise metadata
          ...(options?.engine_version && { engine_version: options.engine_version }),
          ...(options?.policy_mode && { policy_mode: options.policy_mode }),
          ...(options?.policy_hash && { policy_hash: options.policy_hash }),
        },
      };
    } catch (err) {
      log.error('sessionHistory', 'exportSession failed:', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  /**
   * Purge sessions by policy. Two-step safe: mode must be explicit.
   * Only deletes session-*.json files — never touches audit.log, config, license, usage.
   * deleted_session_ids capped at 100, always sorted lexicographic.
   */
  async purgeByPolicy(options: {
    mode: 'all' | 'by_policy';
    older_than_days?: number;
    keep_last?: number;
    dry_run?: boolean;
  }): Promise<PurgeResult> {
    const emptyResult: PurgeResult = {
      deleted_count: 0, retained_count: 0, scanned_count: 0,
      deleted_session_ids: [], truncated: false,
      dry_run: options.dry_run ?? false, no_op: false,
    };

    try {
      await fs.mkdir(this.dataDir, { recursive: true });

      const files = await fs.readdir(this.dataDir);
      const sessionFiles = files
        .filter((f) => f.startsWith('session-') && f.endsWith('.json'));

      if (sessionFiles.length === 0) {
        return { ...emptyResult, no_op: true };
      }

      // Load all sessions with timestamps
      interface SessionEntry {
        file: string;
        id: string;
        created_at: number;
      }
      const entries: SessionEntry[] = [];

      for (const file of sessionFiles) {
        try {
          const data = await fs.readFile(path.join(this.dataDir, file), 'utf8');
          const session = JSON.parse(data) as Session;
          const id = file.replace(/^session-/, '').replace(/\.json$/, '');
          entries.push({ file, id, created_at: session.created_at });
        } catch {
          // Skip corrupt files
          continue;
        }
      }

      // Sort newest-first for keep_last protection
      entries.sort((a, b) => b.created_at - a.created_at);

      // Determine which sessions to delete
      let toDelete: SessionEntry[];

      if (options.mode === 'all') {
        toDelete = [...entries];
      } else {
        // mode === 'by_policy' — filter by age
        if (!options.older_than_days) {
          return { ...emptyResult, scanned_count: entries.length, retained_count: entries.length, no_op: true };
        }
        const cutoffMs = Date.now() - (options.older_than_days * 24 * 60 * 60 * 1000);
        const cutoffDate = new Date(cutoffMs).toISOString();

        toDelete = entries.filter((e) => e.created_at < cutoffMs);
        emptyResult.cutoff_date = cutoffDate;
        emptyResult.effective_older_than_days = options.older_than_days;
      }

      // Apply keep_last protection: protect the N newest globally
      if (options.keep_last !== undefined && options.keep_last > 0) {
        const protectedIds = new Set(
          entries.slice(0, options.keep_last).map((e) => e.id),
        );
        toDelete = toDelete.filter((e) => !protectedIds.has(e.id));
      }

      const retained = entries.length - toDelete.length;

      // Collect IDs (sorted lexicographic, capped at 100)
      const deletedIds = toDelete.map((e) => e.id).sort();
      const truncated = deletedIds.length > 100;
      const cappedIds = deletedIds.slice(0, 100);

      // Execute deletions (unless dry_run)
      if (!options.dry_run) {
        for (const entry of toDelete) {
          try {
            await fs.unlink(path.join(this.dataDir, entry.file));
          } catch {
            // Best-effort deletion
          }
        }
      }

      return {
        deleted_count: toDelete.length,
        retained_count: retained,
        scanned_count: entries.length,
        deleted_session_ids: cappedIds,
        truncated,
        dry_run: options.dry_run ?? false,
        no_op: false,
        ...(emptyResult.cutoff_date && { cutoff_date: emptyResult.cutoff_date }),
        ...(emptyResult.effective_older_than_days !== undefined && {
          effective_older_than_days: emptyResult.effective_older_than_days,
        }),
      };
    } catch (err) {
      log.error('sessionHistory', 'purgeByPolicy failed:', err instanceof Error ? err.message : String(err));
      return { ...emptyResult, no_op: false };
    }
  }

  /**
   * Delete a session file.
   * Returns success status.
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const sanitized = sanitizeSessionId(sessionId);
      const sessionPath = path.join(this.dataDir, `session-${sanitized}.json`);

      await fs.unlink(sessionPath);
      log.debug('sessionHistory', `Deleted session ${sanitized}`);
      return true;
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        return false; // File didn't exist — not an error
      }
      log.error('sessionHistory', 'deleteSession failed:', err instanceof Error ? err.message : String(err));
      return false;
    }
  }
}

// ─── Singleton Export ──────────────────────────────────────────────────────────

export const sessionHistory = new SessionHistoryManager();
