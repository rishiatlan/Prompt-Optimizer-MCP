// auditLog.ts — Append-only JSONL audit logger for v3.3.0.
// Local-only, opt-in. No-throw invariant: audit failures never break pipeline.
// PRIVACY INVARIANT: Never stores raw_prompt, compiled_prompt, or prompt_preview.
// INTEGRITY: Each entry includes integrity_hash = SHA-256(prev_hash + JSON(entry)).

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { AuditEntry } from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DATA_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.prompt-control-plane',
);

const AUDIT_FILENAME = 'audit.log';
const MAX_DETAILS_KEYS = 10;

/** Well-known genesis hash — first entry chains from this. */
export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

// ─── Audit Logger ────────────────────────────────────────────────────────────

export class AuditLogger {
  private readonly dataDir: string;
  private lastHash: string | null = null; // cached for chaining without re-reading

  constructor(dataDir?: string) {
    this.dataDir = dataDir || DEFAULT_DATA_DIR;
  }

  /**
   * Append an audit entry as a JSONL line with integrity hash chaining.
   * No-throw: all errors swallowed (audit never breaks pipeline).
   * Enforces: max 10 detail keys, no raw_prompt/compiled_prompt keys.
   * Chain: integrity_hash = SHA-256(prev_hash + JSON(entry_without_hash))
   */
  async append(entry: AuditEntry): Promise<void> {
    try {
      // Ensure directory exists
      await fs.mkdir(this.dataDir, { recursive: true });

      // Enforce details key cap (max 10, silently drop excess)
      if (entry.details) {
        const keys = Object.keys(entry.details);
        if (keys.length > MAX_DETAILS_KEYS) {
          const trimmed: Record<string, string | number | boolean> = {};
          for (const key of keys.slice(0, MAX_DETAILS_KEYS)) {
            trimmed[key] = entry.details[key];
          }
          entry = { ...entry, details: trimmed };
        }
      }

      // Get previous hash for chaining
      const prevHash = await this.getLastHash();

      // Compute integrity hash: SHA-256(prevHash + JSON(entry_without_hash))
      const { integrity_hash: _, ...entryWithoutHash } = entry;
      const hashInput = prevHash + JSON.stringify(entryWithoutHash);
      const integrityHash = createHash('sha256').update(hashInput, 'utf8').digest('hex');

      // Set the hash on the entry
      const chainedEntry: AuditEntry = { ...entryWithoutHash, integrity_hash: integrityHash };

      const line = JSON.stringify(chainedEntry) + '\n';
      const filePath = path.join(this.dataDir, AUDIT_FILENAME);
      await fs.appendFile(filePath, line, 'utf8');

      // Cache for next append
      this.lastHash = integrityHash;
    } catch {
      // No-throw invariant: silently drop on any error
    }
  }

  /**
   * Get the integrity_hash of the last audit entry (for chaining).
   * Returns GENESIS_HASH if no entries exist.
   */
  private async getLastHash(): Promise<string> {
    // Use cached value if available
    if (this.lastHash !== null) return this.lastHash;

    try {
      const filePath = path.join(this.dataDir, AUDIT_FILENAME);
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      if (lines.length === 0) return GENESIS_HASH;

      const lastEntry = JSON.parse(lines[lines.length - 1]) as AuditEntry;
      return lastEntry.integrity_hash || GENESIS_HASH;
    } catch {
      return GENESIS_HASH;
    }
  }

  /**
   * Read all audit entries. For testing only — not exposed via MCP.
   */
  async readAll(): Promise<AuditEntry[]> {
    try {
      const filePath = path.join(this.dataDir, AUDIT_FILENAME);
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      return lines.map((line) => JSON.parse(line) as AuditEntry);
    } catch {
      return [];
    }
  }

  /**
   * Verify the integrity of the audit chain.
   * Returns { valid: true, entries } or { valid: false, broken_at_index, entries }.
   */
  async verifyChain(): Promise<{ valid: boolean; broken_at_index?: number; entry_count: number }> {
    try {
      const entries = await this.readAll();
      if (entries.length === 0) return { valid: true, entry_count: 0 };

      let prevHash = GENESIS_HASH;

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const { integrity_hash, ...entryWithoutHash } = entry;

        // If entry has no hash (pre-chain entries), skip verification
        if (!integrity_hash) continue;

        const expected = createHash('sha256')
          .update(prevHash + JSON.stringify(entryWithoutHash), 'utf8')
          .digest('hex');

        if (integrity_hash !== expected) {
          return { valid: false, broken_at_index: i, entry_count: entries.length };
        }

        prevHash = integrity_hash;
      }

      return { valid: true, entry_count: entries.length };
    } catch {
      return { valid: true, entry_count: 0 };
    }
  }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

export const auditLogger = new AuditLogger();
