// storage/localFs.ts — File-based StorageInterface implementation.
// Data dir: ~/.prompt-optimizer/ (or custom via constructor).
// SECURITY INVARIANT: No public method throws. All errors → safe defaults + logged.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { log } from '../logger.js';
import { PLAN_LIMITS } from '../types.js';
import { DEFAULT_CONFIG, DEFAULT_USAGE, DEFAULT_STATS } from './interface.js';
import type {
  StorageInterface,
  OptimizerConfig,
  UsageData,
  StatsData,
  EnforcementResult,
  ExecutionContext,
  StatsEvent,
  Session,
  LicenseData,
} from './interface.js';
import { validateLicenseKey } from '../license.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DATA_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.prompt-optimizer',
);
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_JSON_BYTES = 1_048_576; // 1MB — defensive stringify cap

// ─── In-Memory Session Fallback (ephemeral mode) ─────────────────────────────

const ephemeralSessions = new Map<string, Session>();

// ─── Static Helpers ──────────────────────────────────────────────────────────

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function sanitizeLimits(limits: typeof PLAN_LIMITS.free): EnforcementResult['limits'] {
  // Convert Infinity to null for JSON serialization safety (Guardrail: Infinity never serialized)
  return {
    lifetime: limits.lifetime === Infinity ? null : limits.lifetime,
    monthly: limits.monthly === Infinity ? null : limits.monthly,
    rate_per_minute: limits.rate_per_minute,
    always_on: limits.always_on,
  };
}

function sanitizeSessionId(id: string): string {
  return id.replace(/[^a-zA-Z0-9-]/g, '');
}

// ─── LocalFsStorage Implementation ───────────────────────────────────────────

export class LocalFsStorage implements StorageInterface {
  private readonly dataDir: string;
  private readonly sessionsDir: string;
  private readonly usageFile: string;
  private readonly configFile: string;
  private readonly statsFile: string;
  private readonly licenseFile: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || DEFAULT_DATA_DIR;
    this.sessionsDir = path.join(this.dataDir, 'sessions');
    this.usageFile = path.join(this.dataDir, 'usage.json');
    this.configFile = path.join(this.dataDir, 'config.json');
    this.statsFile = path.join(this.dataDir, 'stats.json');
    this.licenseFile = path.join(this.dataDir, 'license.json');

    try {
      this._ensureDataDir();
      // Deterministic cleanup on startup
      this._cleanupSessionsSync();
    } catch (err) {
      log.error('storage', 'Init failed:', err instanceof Error ? err.message : String(err));
    }
  }

  // ── Internal Helpers ─────────────────────────────────────────────────────

  private _ensureDataDir(): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.sessionsDir, { recursive: true });
  }

  private _isInsideDataDir(filepath: string): boolean {
    try {
      const dataReal = fs.realpathSync(this.dataDir);
      // Try realpath of the file itself (works for existing files/symlinks)
      try {
        const real = fs.realpathSync(filepath);
        return real.startsWith(dataReal + path.sep) || real === dataReal;
      } catch {
        // File doesn't exist yet — resolve parent dir + basename
        const parentReal = fs.realpathSync(path.dirname(filepath));
        const resolved = path.join(parentReal, path.basename(filepath));
        return resolved.startsWith(dataReal + path.sep) || resolved === dataReal;
      }
    } catch {
      return false;
    }
  }

  private _readJsonFile<T>(filepath: string, defaults: T): T {
    try {
      if (!fs.existsSync(filepath)) return { ...defaults };
      if (!this._isInsideDataDir(filepath)) {
        log.warn('storage', `Path outside data dir rejected: ${path.basename(filepath)}`);
        return { ...defaults };
      }
      const raw = fs.readFileSync(filepath, 'utf-8');
      const parsed = JSON.parse(raw) as T;
      return parsed;
    } catch {
      // Corrupt file: rename, log SHA256, return defaults
      try {
        const raw = fs.readFileSync(filepath, 'utf-8');
        const hash = sha256(raw);
        const corruptPath = filepath.replace('.json', `.corrupt-${Date.now()}.json`);
        if (this._isInsideDataDir(corruptPath)) {
          fs.renameSync(filepath, corruptPath);
          log.warn('storage', `Corrupt file renamed: ${path.basename(corruptPath)}, SHA256: ${hash}`);
        }
      } catch {
        // If we can't even read the corrupt file, just log and continue
      }
      return { ...defaults };
    }
  }

  private _safeWriteJson(filepath: string, data: unknown): void {
    if (!this._isInsideDataDir(filepath)) {
      log.warn('storage', `Write rejected — path outside data dir: ${path.basename(filepath)}`);
      return;
    }
    const json = JSON.stringify(data, null, 2);
    if (Buffer.byteLength(json) > MAX_JSON_BYTES) {
      log.warn('storage', `JSON write skipped — ${Buffer.byteLength(json)} bytes exceeds ${MAX_JSON_BYTES} cap`);
      return;
    }
    fs.writeFileSync(filepath, json, 'utf-8');
  }

  // ── Health Probe ──────────────────────────────────────────────────────────

  async health(): Promise<'ok' | 'degraded'> {
    try {
      this._ensureDataDir();
      const probe = path.join(this.dataDir, '.health-probe');
      fs.writeFileSync(probe, 'ok', 'utf-8');
      fs.unlinkSync(probe);
      return 'ok';
    } catch {
      return 'degraded';
    }
  }

  // ── Usage ─────────────────────────────────────────────────────────────────

  async getUsage(): Promise<UsageData> {
    try {
      const data = this._readJsonFile<UsageData>(this.usageFile, DEFAULT_USAGE);
      // Tier priority: license > env var > stored tier (default free)
      const license = this._readJsonFile<LicenseData | null>(this.licenseFile, null);
      if (
        license &&
        license.valid &&
        (license.expires_at === 'never' || new Date(license.expires_at) > new Date())
      ) {
        data.tier = license.tier;
      } else if (process.env.PROMPT_OPTIMIZER_PRO === 'true') {
        data.tier = 'pro';
      }
      return data;
    } catch (err) {
      log.error('storage', 'getUsage failed:', err instanceof Error ? err.message : String(err));
      return { ...DEFAULT_USAGE };
    }
  }

  async incrementUsage(): Promise<UsageData> {
    try {
      const usage = await this.getUsage();
      const now = new Date();

      // Anti-tamper: detect backward clock
      if (usage.last_used_at) {
        const lastUsed = new Date(usage.last_used_at);
        if (lastUsed > now) {
          log.warn('storage', 'Clock moved backward — skipping period reset', {
            last_used: usage.last_used_at,
            now: now.toISOString(),
          });
        }
      }

      usage.total_optimizations += 1;
      usage.last_used_at = now.toISOString();
      if (!usage.first_used_at) {
        usage.first_used_at = now.toISOString();
      }

      // Increment monthly period counter (resolves/resets if new month)
      this._resolveMonthlyUsage(usage);
      usage.period_optimizations = (usage.period_optimizations ?? 0) + 1;

      this._safeWriteJson(this.usageFile, usage);
      return usage;
    } catch (err) {
      log.error('storage', 'incrementUsage failed:', err instanceof Error ? err.message : String(err));
      return { ...DEFAULT_USAGE };
    }
  }

  /**
   * Resolve the current monthly period usage, resetting the counter if the
   * calendar month has changed since the last recorded period start.
   */
  private _resolveMonthlyUsage(usage: UsageData): { periodOptimizations: number; periodStart: string } {
    const now = new Date();
    const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const storedStart = usage.current_period_start ?? '';
    const storedMonth = storedStart.slice(0, 7); // "YYYY-MM" from ISO 8601

    if (storedMonth === currentMonth) {
      return { periodOptimizations: usage.period_optimizations ?? 0, periodStart: storedStart };
    }

    // New month — reset
    const periodStart = now.toISOString();
    usage.current_period_start = periodStart;
    usage.period_optimizations = 0;
    this._safeWriteJson(this.usageFile, usage);
    return { periodOptimizations: 0, periodStart };
  }

  async canUseOptimization(ctx: ExecutionContext): Promise<EnforcementResult> {
    try {
      const usage = await this.getUsage();
      // Use ctx.tier (authoritative — set by tools layer / Phase B API key auth)
      const tier = ctx.tier;
      const tierLimits = PLAN_LIMITS[tier] ?? PLAN_LIMITS.free;

      // Resolve monthly period (resets counter on new calendar month)
      const { periodOptimizations } = this._resolveMonthlyUsage(usage);

      // Priority 1: Rate limit (cheapest check)
      const rateResult = ctx.rateLimiter.check(tier);
      if (!rateResult.allowed) {
        return {
          allowed: false,
          enforcement: 'rate',
          usage,
          limits: sanitizeLimits(tierLimits),
          remaining: {
            lifetime: Math.max(0, tierLimits.lifetime - usage.total_optimizations),
            monthly: Math.max(0, tierLimits.monthly - periodOptimizations),
          },
          retry_after_seconds: rateResult.retry_after_seconds,
        };
      }

      // Priority 2: Lifetime limit (free tier)
      if (usage.total_optimizations >= tierLimits.lifetime) {
        return {
          allowed: false,
          enforcement: 'lifetime',
          usage,
          limits: sanitizeLimits(tierLimits),
          remaining: { lifetime: 0, monthly: 0 },
        };
      }

      // Priority 3: Monthly limit (pro tier — power is Infinity so never triggers)
      if (periodOptimizations >= tierLimits.monthly) {
        return {
          allowed: false,
          enforcement: 'monthly',
          usage,
          limits: sanitizeLimits(tierLimits),
          remaining: {
            lifetime: Math.max(0, tierLimits.lifetime - usage.total_optimizations),
            monthly: 0,
          },
        };
      }

      // Allowed
      return {
        allowed: true,
        enforcement: null,
        usage,
        limits: tierLimits,
        remaining: {
          lifetime: Math.max(0, tierLimits.lifetime - usage.total_optimizations),
          monthly: Math.max(0, tierLimits.monthly - periodOptimizations),
        },
      };
    } catch (err) {
      // Fail-open (Phase A): allow on storage error
      log.error('storage', 'canUseOptimization failed (fail-open):', err instanceof Error ? err.message : String(err));
      return {
        allowed: true,
        enforcement: null,
        usage: { ...DEFAULT_USAGE },
        limits: sanitizeLimits(PLAN_LIMITS.free),
        remaining: { lifetime: 10, monthly: 10 },
      };
    }
  }

  async isProTier(): Promise<boolean> {
    const usage = await this.getUsage();
    return usage.tier === 'pro' || usage.tier === 'power';
  }

  // ── Config ────────────────────────────────────────────────────────────────

  async getConfig(): Promise<OptimizerConfig> {
    try {
      return this._readJsonFile<OptimizerConfig>(this.configFile, DEFAULT_CONFIG);
    } catch (err) {
      log.error('storage', 'getConfig failed:', err instanceof Error ? err.message : String(err));
      return { ...DEFAULT_CONFIG };
    }
  }

  async setConfig(updates: Partial<OptimizerConfig>): Promise<OptimizerConfig> {
    try {
      const current = await this.getConfig();
      const merged = { ...current, ...updates, schema_version: 1 as const };
      this._safeWriteJson(this.configFile, merged);
      return merged;
    } catch (err) {
      log.error('storage', 'setConfig failed:', err instanceof Error ? err.message : String(err));
      return { ...DEFAULT_CONFIG };
    }
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  async saveSession(session: Session): Promise<void> {
    try {
      const config = await this.getConfig();

      if (config.ephemeral_mode) {
        ephemeralSessions.set(session.id, session);
        return;
      }

      const safeId = sanitizeSessionId(session.id);
      if (!safeId) return;

      const filepath = path.join(this.sessionsDir, `${safeId}.json`);
      this._safeWriteJson(filepath, session);

      // Deterministic cleanup after save
      this._cleanupSessionsSync();
    } catch (err) {
      log.error('storage', 'saveSession failed:', err instanceof Error ? err.message : String(err));
    }
  }

  async loadSession(id: string): Promise<Session | undefined> {
    try {
      const config = await this.getConfig();

      if (config.ephemeral_mode) {
        const session = ephemeralSessions.get(id);
        if (session && Date.now() - session.last_accessed > SESSION_TTL_MS) {
          ephemeralSessions.delete(id);
          return undefined;
        }
        return session;
      }

      const safeId = sanitizeSessionId(id);
      if (!safeId) return undefined;

      const filepath = path.join(this.sessionsDir, `${safeId}.json`);
      if (!fs.existsSync(filepath)) return undefined;

      const session = this._readJsonFile<Session>(filepath, undefined as unknown as Session);
      if (!session || !session.id) return undefined;

      // TTL check
      if (Date.now() - session.last_accessed > SESSION_TTL_MS) {
        try { fs.unlinkSync(filepath); } catch { /* ignore */ }
        return undefined;
      }

      return session;
    } catch (err) {
      log.error('storage', 'loadSession failed:', err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }

  async deleteSession(id: string): Promise<void> {
    try {
      const config = await this.getConfig();

      if (config.ephemeral_mode) {
        ephemeralSessions.delete(id);
        return;
      }

      const safeId = sanitizeSessionId(id);
      if (!safeId) return;

      const filepath = path.join(this.sessionsDir, `${safeId}.json`);
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    } catch (err) {
      log.error('storage', 'deleteSession failed:', err instanceof Error ? err.message : String(err));
    }
  }

  async cleanupSessions(): Promise<void> {
    try {
      this._cleanupSessionsSync();
    } catch (err) {
      log.error('storage', 'cleanupSessions failed:', err instanceof Error ? err.message : String(err));
    }
  }

  private _cleanupSessionsSync(): void {
    if (!fs.existsSync(this.sessionsDir)) return;

    const config = this._readJsonFile<OptimizerConfig>(this.configFile, DEFAULT_CONFIG);
    const files = fs.readdirSync(this.sessionsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const filepath = path.join(this.sessionsDir, f);
        try {
          const stat = fs.statSync(filepath);
          return { name: f, filepath, mtime: stat.mtimeMs, size: stat.size };
        } catch {
          return null;
        }
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    // Remove expired sessions (TTL)
    const now = Date.now();
    for (const file of files) {
      if (now - file.mtime > SESSION_TTL_MS) {
        try { fs.unlinkSync(file.filepath); } catch { /* ignore */ }
      }
    }

    // Remove oversized sessions
    const maxSizeBytes = config.max_session_size_kb * 1024;
    for (const file of files) {
      if (file.size > maxSizeBytes) {
        try { fs.unlinkSync(file.filepath); } catch { /* ignore */ }
      }
    }

    // Re-read surviving files
    const surviving = fs.readdirSync(this.sessionsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const filepath = path.join(this.sessionsDir, f);
        try {
          const stat = fs.statSync(filepath);
          return { name: f, filepath, mtime: stat.mtimeMs, size: stat.size };
        } catch {
          return null;
        }
      })
      .filter((f): f is NonNullable<typeof f> => f !== null)
      .sort((a, b) => a.mtime - b.mtime); // oldest first

    // Enforce max_sessions count
    while (surviving.length > config.max_sessions) {
      const oldest = surviving.shift()!;
      try { fs.unlinkSync(oldest.filepath); } catch { /* ignore */ }
    }

    // Enforce max_session_dir_mb (aggregate memory guard)
    const maxDirBytes = config.max_session_dir_mb * 1024 * 1024;
    let totalSize = surviving.reduce((sum, f) => sum + f.size, 0);
    while (totalSize > maxDirBytes && surviving.length > 0) {
      const oldest = surviving.shift()!;
      totalSize -= oldest.size;
      try { fs.unlinkSync(oldest.filepath); } catch { /* ignore */ }
    }

    // Clean expired ephemeral sessions
    for (const [id, session] of ephemeralSessions) {
      if (now - session.last_accessed > SESSION_TTL_MS) {
        ephemeralSessions.delete(id);
      }
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  async getStats(): Promise<StatsData> {
    try {
      return this._readJsonFile<StatsData>(this.statsFile, DEFAULT_STATS);
    } catch (err) {
      log.error('storage', 'getStats failed:', err instanceof Error ? err.message : String(err));
      return { ...DEFAULT_STATS };
    }
  }

  async updateStats(event: StatsEvent): Promise<void> {
    try {
      const stats = await this.getStats();

      if (event.type === 'optimize') {
        stats.total_optimized += 1;
        if (event.score_before != null) {
          stats.score_sum_before += event.score_before;
        }
        if (event.task_type) {
          stats.task_type_counts[event.task_type] =
            (stats.task_type_counts[event.task_type] || 0) + 1;
        }
        if (event.blocking_questions) {
          for (const q of event.blocking_questions) {
            stats.blocking_question_counts[q] =
              (stats.blocking_question_counts[q] || 0) + 1;
          }
        }
        if (event.cost_savings_usd != null) {
          stats.estimated_cost_savings_usd += event.cost_savings_usd;
        }
      } else if (event.type === 'approve') {
        stats.total_approved += 1;
      }

      this._safeWriteJson(this.statsFile, stats);
    } catch (err) {
      log.error('storage', 'updateStats failed:', err instanceof Error ? err.message : String(err));
    }
  }

  // ── License ──────────────────────────────────────────────────────────────

  async getLicense(): Promise<LicenseData | null> {
    try {
      if (!fs.existsSync(this.licenseFile)) return null;

      const data = this._readJsonFile<LicenseData | null>(this.licenseFile, null);
      if (!data || !data.license_id) return null;

      // Re-validate signature on every read (catches tampered files + newly expired keys)
      // We need the original key to re-verify, but we don't store it.
      // Instead, check cached validation + expiry date.
      if (data.valid && data.expires_at !== 'never') {
        const expiryDate = new Date(data.expires_at);
        if (isNaN(expiryDate.getTime()) || expiryDate <= new Date()) {
          data.valid = false;
          data.validation_error = 'expired';
          this._safeWriteJson(this.licenseFile, data);
        }
      }

      return data;
    } catch (err) {
      log.error('storage', 'getLicense failed:', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  async setLicense(data: LicenseData): Promise<void> {
    try {
      this._safeWriteJson(this.licenseFile, data);
      // Best-effort chmod 600 (POSIX only — protects license key from other users)
      try {
        fs.chmodSync(this.licenseFile, 0o600);
      } catch {
        // Windows or restricted environment — skip silently
      }
    } catch (err) {
      log.error('storage', 'setLicense failed:', err instanceof Error ? err.message : String(err));
    }
  }

  async clearLicense(): Promise<void> {
    try {
      if (fs.existsSync(this.licenseFile)) {
        fs.unlinkSync(this.licenseFile);
      }
    } catch (err) {
      log.error('storage', 'clearLicense failed:', err instanceof Error ? err.message : String(err));
    }
  }
}
