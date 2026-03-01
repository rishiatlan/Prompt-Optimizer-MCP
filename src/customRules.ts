// customRules.ts — Custom rule management for v3.2.1
// File-based CRUD, validation, deterministic hashing, rule evaluation

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { log } from './logger.js';
import type { CustomRule, CustomRulesConfig, TaskType, RuleMatch } from './types.js';

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_DATA_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.prompt-optimizer',
);

const MAX_RULES = 25;
const MAX_PATTERN_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_ID_LENGTH = 64;
const ID_REGEX = /^[a-z][a-z0-9_]{0,63}$/;

const VALID_APPLIES_TO = ['code', 'prose', 'all'] as const;
const VALID_SEVERITY = ['BLOCKING', 'NON-BLOCKING'] as const;
const VALID_RISK_DIMENSIONS = ['hallucination', 'constraint', 'underspec', 'scope'] as const;

// ─── Custom Rules Manager ──────────────────────────────────────────────────

export class CustomRulesManager {
  private readonly dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || DEFAULT_DATA_DIR;
  }

  /**
   * Load custom rules from disk and validate.
   * Returns sorted by ID, filtered (max 25), with invalid rules skipped.
   */
  async loadRules(): Promise<CustomRule[]> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });

      const filePath = path.join(this.dataDir, 'custom-rules.json');
      const data = await fs.readFile(filePath, 'utf8');
      const config = JSON.parse(data) as CustomRulesConfig;

      if (!Array.isArray(config.rules)) {
        log.warn('customRules', 'Invalid config: rules is not an array');
        return [];
      }

      // Validate and filter
      const validRules: CustomRule[] = [];
      for (const rule of config.rules) {
        const validation = this.validateRule(rule);
        if (validation.valid) {
          validRules.push(rule as CustomRule);
        } else {
          log.warn('customRules', `Skipping invalid rule (${rule.id}):`, validation.errors.join('; '));
        }
      }

      // Apply hard cap
      if (validRules.length > MAX_RULES) {
        log.warn('customRules', `Loaded ${validRules.length} rules, capping at ${MAX_RULES}`);
        validRules.length = MAX_RULES;
      }

      // Sort by ID for determinism
      validRules.sort((a, b) => a.id.localeCompare(b.id));

      log.debug('customRules', `Loaded ${validRules.length} rules from ${filePath}`);
      return validRules;
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        // File doesn't exist — normal case
        log.debug('customRules', 'No custom-rules.json found (not an error)');
        return [];
      }
      log.error('customRules', 'loadRules failed:', err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  /**
   * Validate a single rule object.
   * Returns { valid: bool, errors: string[] }
   */
  validateRule(rule: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // ID validation
    if (!rule.id || typeof rule.id !== 'string') {
      errors.push('ID is required and must be a string');
    } else if (rule.id.length > MAX_ID_LENGTH) {
      errors.push(`ID max ${MAX_ID_LENGTH} chars`);
    } else if (!ID_REGEX.test(rule.id)) {
      errors.push(`ID must match regex ^[a-z][a-z0-9_]{0,63}$ (got: ${rule.id})`);
    }

    // Description validation
    if (!rule.description || typeof rule.description !== 'string') {
      errors.push('Description is required and must be a string');
    } else if (rule.description.length > MAX_DESCRIPTION_LENGTH) {
      errors.push(`Description max ${MAX_DESCRIPTION_LENGTH} chars`);
    }

    // Pattern validation
    if (!rule.pattern || typeof rule.pattern !== 'string') {
      errors.push('Pattern is required and must be a string');
    } else if (rule.pattern.length > MAX_PATTERN_LENGTH) {
      errors.push(`pattern max ${MAX_PATTERN_LENGTH} chars`);
    } else {
      try {
        new RegExp(rule.pattern);
      } catch {
        errors.push(`Pattern is not a valid regex: ${rule.pattern}`);
      }
    }

    // Negative pattern validation (optional)
    if (rule.negative_pattern) {
      if (typeof rule.negative_pattern !== 'string') {
        errors.push('Negative pattern must be a string');
      } else if (rule.negative_pattern.length > MAX_PATTERN_LENGTH) {
        errors.push(`Negative pattern max ${MAX_PATTERN_LENGTH} chars`);
      } else {
        try {
          new RegExp(rule.negative_pattern);
        } catch {
          errors.push(`Negative pattern is not a valid regex: ${rule.negative_pattern}`);
        }
      }
    }

    // applies_to validation
    if (!VALID_APPLIES_TO.includes(rule.applies_to)) {
      errors.push(`applies_to must be one of: ${VALID_APPLIES_TO.join(', ')}`);
    }

    // severity validation
    if (!VALID_SEVERITY.includes(rule.severity)) {
      errors.push(`severity must be one of: ${VALID_SEVERITY.join(', ')}`);
    }

    // risk_dimension validation
    if (!VALID_RISK_DIMENSIONS.includes(rule.risk_dimension)) {
      errors.push(`risk_dimension must be one of: ${VALID_RISK_DIMENSIONS.join(', ')}`);
    }

    // risk_weight validation
    if (typeof rule.risk_weight !== 'number' || !Number.isInteger(rule.risk_weight)) {
      errors.push('risk_weight must be an integer');
    } else if (rule.risk_weight < 1 || rule.risk_weight > 25) {
      errors.push(`risk_weight must be 1-25 (got: ${rule.risk_weight})`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Evaluate a rule against a prompt.
   * Returns RuleMatch or null if rule doesn't apply to task type or doesn't match.
   */
  async evaluateRule(
    rule: CustomRule,
    prompt: string,
    taskType: TaskType,
  ): Promise<RuleMatch | null> {
    try {
      // Check applies_to scope
      if (!this.ruleAppliesToTaskType(rule, taskType)) {
        return null;
      }

      // Compile regexes (try/catch for safety)
      let patternRegex: RegExp;
      try {
        patternRegex = new RegExp(rule.pattern);
      } catch (err) {
        return {
          rule_id: `custom_${rule.id}`,
          matched: false,
          description: rule.description,
          severity: rule.severity,
          error: `Pattern compilation failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      // Check if pattern matches
      const patternMatches = patternRegex.test(prompt);
      if (!patternMatches) {
        return null; // Pattern didn't match, rule doesn't apply
      }

      // Check negative pattern (if present)
      if (rule.negative_pattern) {
        let negRegex: RegExp;
        try {
          negRegex = new RegExp(rule.negative_pattern);
        } catch (err) {
          return {
            rule_id: `custom_${rule.id}`,
            matched: false,
            description: rule.description,
            severity: rule.severity,
            error: `Negative pattern compilation failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        // Negative pattern match means rule does NOT apply
        if (negRegex.test(prompt)) {
          return null;
        }
      }

      // Rule matched!
      return {
        rule_id: `custom_${rule.id}`,
        matched: true,
        description: rule.description,
        severity: rule.severity,
        custom_weight: rule.risk_weight,
        risk_dimension: rule.risk_dimension,
      };
    } catch (err) {
      log.error('customRules', `evaluateRule failed (${rule.id}):`, err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  /**
   * Get rules applicable to a task type, sorted by ID.
   */
  async getRulesForTask(taskType: TaskType): Promise<CustomRule[]> {
    const allRules = await this.loadRules();
    return allRules.filter(r => this.ruleAppliesToTaskType(r, taskType));
  }

  /**
   * Calculate deterministic rule-set hash.
   * Format: sorted by ID, then for each rule: id\npattern\nneg_pattern\napplies_to\nseverity\nrisk_dimension\nweight
   * Joined with \n, SHA-256 UTF-8 hex lowercase.
   */
  calculateRuleSetHash(rules: CustomRule[]): string {
    if (rules.length === 0) {
      return '';
    }

    const sorted = [...rules].sort((a, b) => a.id.localeCompare(b.id));
    const hashInput = sorted
      .map(r =>
        `${r.id}\n${r.pattern}\n${r.negative_pattern || ''}\n${r.applies_to}\n${r.severity}\n${r.risk_dimension}\n${r.risk_weight}`,
      )
      .join('\n');

    return createHash('sha256').update(hashInput, 'utf8').digest('hex');
  }

  /**
   * Helper: Check if rule applies to task type.
   */
  private ruleAppliesToTaskType(rule: CustomRule, taskType: TaskType): boolean {
    if (rule.applies_to === 'all') {
      return true;
    }

    const isCodeTask =
      ['code_change', 'debug', 'create', 'refactor'].includes(taskType);
    const isProseTask =
      ['writing', 'communication', 'planning'].includes(taskType);

    return (
      (rule.applies_to === 'code' && isCodeTask) ||
      (rule.applies_to === 'prose' && isProseTask)
    );
  }
}

// ─── Singleton Export ──────────────────────────────────────────────────────

export const customRules = new CustomRulesManager();
