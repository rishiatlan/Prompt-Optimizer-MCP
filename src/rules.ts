// rules.ts — Deterministic ambiguity detection rules. No LLM calls.
// Rules are task-type aware: code-only rules skip for prose/research tasks.

import type { RuleResult, RiskLevel, TaskType } from './types.js';
import { isCodeTask, isProseTask } from './types.js';

// ─── Rule Definitions ─────────────────────────────────────────────────────────

interface Rule {
  name: string;
  /** Which task types this rule applies to. 'all' = always run. */
  applies_to: 'code' | 'prose' | 'all';
  check: (prompt: string, context?: string) => RuleResult;
}

// ─── Pattern Libraries ────────────────────────────────────────────────────────

const VAGUE_CODE_PATTERNS = [
  /\bmake\s+it\s+(better|work|good|nice|faster|cleaner)\b/i,
  /\b(improve|enhance|optimize|update|change|fix|tweak)\b(?!.*\b(in|at|for|the file|function|class|module|component)\b)/i,
  /\bdo\s+something\s+(about|with)\b/i,
  /\bhandle\s+this\b/i,
];

const FILE_PATH_PATTERNS = [
  /\b[\w\-./]+\.(ts|js|tsx|jsx|py|go|rs|java|rb|css|html|json|yaml|yml|md|sql|sh)\b/,
  /\b(src|lib|app|pages|components|utils|test|spec)\//,
  /\.\//,
];

const CODE_REF_PATTERNS = [
  /\b(function|class|method|interface|type|enum|const|let|var|def|fn)\s+\w+/i,
  /\b\w+\(\)/,
  /\b\w+\.\w+\(/,
];

const SCOPE_EXPLOSION_CODE = [
  /\b(everything|entire|whole)\b(?![\w\s]{0,25}\b(files?|functions?|class(?:es)?|tests?|modules?|components?|endpoints?|routes?)\b)/i,
  /\b(all|every)\b(?![\w\s]{0,25}\b(files?|functions?|class(?:es)?|tests?|modules?|components?|endpoints?|routes?|the)\b)/i,
  /\bacross\s+the\s+(codebase|project|repo)\b/i,
];

const HIGH_RISK_KEYWORDS = [
  /\b(auth|authentication|authorization|login|password|credential|secret|token|api[_\s]?key)\b/i,
  /\b(payment|billing|invoice|credit\s*card|stripe|transaction|checkout)\b/i,
  /\b(database|migration|schema|drop|truncate|delete\s+from|alter\s+table)\b/i,
  /\b(production|prod|deploy|release|publish|live)\b/i,
  /\b(delete|remove|destroy|purge|wipe|reset)\b/i,
  /\b(security|encryption|certificate|ssl|tls|cors|csrf|xss|injection)\b/i,
];

const FORMAT_REFS = [
  /\b(json|yaml|xml|csv|graphql)\b/i,
  /\breturn\s+(a|the)?\s*(json|object|array|list|table|schema)\b/i,
];

const TASK_SEPARATORS = [
  /\b(also|and\s+also|additionally|plus|on\s+top\s+of\s+that|while\s+you['']?re\s+at\s+it)\b/i,
  /\b(first|second|third|then|after\s+that|next|finally)\b/i,
  /\d+\.\s+\w/g,
];

// ─── Rule Implementations ─────────────────────────────────────────────────────

const rules: Rule[] = [
  // ── Code-only rules ─────────────────────────────────────────────────────
  {
    name: 'vague_objective',
    applies_to: 'code',
    check(prompt) {
      const hasVague = VAGUE_CODE_PATTERNS.some(p => p.test(prompt));
      const hasTarget = FILE_PATH_PATTERNS.some(p => p.test(prompt))
        || CODE_REF_PATTERNS.some(p => p.test(prompt));

      return {
        rule_name: 'vague_objective',
        severity: 'blocking',
        triggered: hasVague && !hasTarget,
        message: 'Objective is vague without a specific target. What exactly should be changed and where?',
        question: hasVague && !hasTarget ? {
          id: 'q_vague_objective',
          question: 'What specific file, function, or component should be changed?',
          reason: 'The prompt uses vague terms without pointing to a specific target.',
          blocking: true,
        } : undefined,
      };
    },
  },

  {
    name: 'missing_target',
    applies_to: 'code',
    check(prompt) {
      const isCode = /\b(code|implement|build|write|create|add|remove|refactor|fix|debug|test)\b/i.test(prompt);
      const hasTarget = FILE_PATH_PATTERNS.some(p => p.test(prompt))
        || CODE_REF_PATTERNS.some(p => p.test(prompt))
        || /\b(the|this|that)\s+(component|module|service|page|endpoint|route|handler|hook|util)\b/i.test(prompt);

      return {
        rule_name: 'missing_target',
        severity: 'blocking',
        triggered: isCode && !hasTarget,
        message: 'Code task detected but no target file, function, or module specified.',
        question: isCode && !hasTarget ? {
          id: 'q_missing_target',
          question: 'Which file(s) or module(s) should this change apply to?',
          reason: 'A code change was requested but no target location was specified.',
          blocking: true,
        } : undefined,
      };
    },
  },

  {
    name: 'scope_explosion',
    applies_to: 'code',
    check(prompt) {
      const hasExplosion = SCOPE_EXPLOSION_CODE.some(p => p.test(prompt));
      return {
        rule_name: 'scope_explosion',
        severity: 'blocking',
        triggered: hasExplosion,
        message: 'Scope is extremely broad. Consider narrowing to specific files or modules.',
        question: hasExplosion ? {
          id: 'q_scope_explosion',
          question: 'Can you narrow the scope? Which specific area should be the focus?',
          reason: 'Terms like "all", "everything", or "entire codebase" suggest an unbounded scope.',
          blocking: true,
        } : undefined,
      };
    },
  },

  {
    name: 'high_risk_domain',
    applies_to: 'code',
    check(prompt) {
      const matchedDomains: string[] = [];
      for (const pattern of HIGH_RISK_KEYWORDS) {
        const match = prompt.match(pattern);
        if (match) matchedDomains.push(match[0]);
      }

      return {
        rule_name: 'high_risk_domain',
        severity: 'non_blocking',
        triggered: matchedDomains.length > 0,
        message: `High-risk domain detected: ${matchedDomains.join(', ')}. Extra caution warranted.`,
        risk_elevation: matchedDomains.length > 0 ? 'high' as RiskLevel : undefined,
      };
    },
  },

  {
    name: 'no_constraints_high_risk',
    applies_to: 'code',
    check(prompt) {
      const isHighRisk = HIGH_RISK_KEYWORDS.some(p => p.test(prompt));
      const hasConstraints = /\b(don['']?t|do\s+not|never|avoid|skip|only|except|without|must\s+not|should\s+not)\b/i.test(prompt)
        || /\b(constraint|limit|boundary|scope|restrict)\b/i.test(prompt);

      return {
        rule_name: 'no_constraints_high_risk',
        severity: 'blocking',
        triggered: isHighRisk && !hasConstraints,
        message: 'High-risk task with no constraints specified. What should NOT be changed or affected?',
        question: isHighRisk && !hasConstraints ? {
          id: 'q_no_constraints',
          question: 'This touches a sensitive area. What are the boundaries — what should NOT be changed?',
          reason: 'High-risk domain detected but no constraints or safety boundaries were mentioned.',
          blocking: true,
        } : undefined,
      };
    },
  },

  // ── Universal rules (all task types) ────────────────────────────────────
  {
    name: 'format_ambiguity',
    applies_to: 'all',
    check(prompt) {
      const mentionsFormat = FORMAT_REFS.some(p => p.test(prompt));
      const hasSchema = /\b(schema|structure|shape|fields?|columns?|properties)\b/i.test(prompt)
        || /\{[\s\S]*:[\s\S]*\}/.test(prompt);

      return {
        rule_name: 'format_ambiguity',
        severity: 'non_blocking',
        triggered: mentionsFormat && !hasSchema,
        message: 'A structured format was mentioned but no schema was provided.',
        assumption: mentionsFormat && !hasSchema ? {
          id: 'a_format_flexible',
          assumption: 'Output format will be inferred from context. No strict schema enforced.',
          confidence: 'medium',
          impact: 'low',
          reversible: true,
        } : undefined,
      };
    },
  },

  {
    name: 'multi_task_overload',
    applies_to: 'all',
    check(prompt) {
      let taskCount = 0;
      for (const pattern of TASK_SEPARATORS) {
        const matches = prompt.match(pattern);
        if (matches) taskCount += matches.length;
      }
      const overloaded = taskCount >= 3;

      return {
        rule_name: 'multi_task_overload',
        severity: 'non_blocking',
        triggered: overloaded,
        message: `Multiple tasks detected in one prompt (~${taskCount} task indicators). Consider splitting for better results.`,
        assumption: overloaded ? {
          id: 'a_multi_task',
          assumption: 'All tasks will be addressed in sequence. Consider splitting into separate prompts for better focus.',
          confidence: 'medium',
          impact: 'medium',
          reversible: true,
        } : undefined,
      };
    },
  },

  // ── Prose-only rules ────────────────────────────────────────────────────
  {
    name: 'missing_audience',
    applies_to: 'prose',
    check(prompt) {
      const hasAudience = /\b(for|to|with)\s+(my\s+)?(team|colleagues?|manager|stakeholders?|engineers?|designers?|leadership|exec|board|customers?|users?|clients?|public|community|audience|channel|everyone)\b/i.test(prompt)
        || /\b(slack|email|blog|twitter|linkedin|newsletter|internal|external)\b/i.test(prompt);

      return {
        rule_name: 'missing_audience',
        severity: 'non_blocking',
        triggered: !hasAudience,
        message: 'No target audience specified. Who will read this?',
        assumption: !hasAudience ? {
          id: 'a_general_audience',
          assumption: 'Writing for a general professional audience. Tone: clear and neutral.',
          confidence: 'medium',
          impact: 'low',
          reversible: true,
        } : undefined,
      };
    },
  },

  {
    name: 'no_clear_ask',
    applies_to: 'prose',
    check(prompt) {
      const hasClearPurpose = /\b(announce|share|ask|request|inform|update|pitch|propose|convince|explain|feedback|review)\b/i.test(prompt);

      return {
        rule_name: 'no_clear_ask',
        severity: 'non_blocking',
        triggered: !hasClearPurpose,
        message: 'No clear communication goal detected. What should the reader do after reading this?',
        assumption: !hasClearPurpose ? {
          id: 'a_informational',
          assumption: 'Message is informational — no specific action required from the reader.',
          confidence: 'medium',
          impact: 'low',
          reversible: true,
        } : undefined,
      };
    },
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/** Run applicable ambiguity rules against a prompt. Task-type aware. */
export function runRules(prompt: string, context?: string, taskType?: TaskType): RuleResult[] {
  return rules
    .filter(rule => {
      if (rule.applies_to === 'all') return true;
      if (rule.applies_to === 'code' && taskType && isCodeTask(taskType)) return true;
      if (rule.applies_to === 'prose' && taskType && isProseTask(taskType)) return true;
      if (!taskType) return true; // backward compat: no type = run all
      return false;
    })
    .map(rule => rule.check(prompt, context))
    .filter(result => result.triggered);
}

/** Extract blocking questions from rule results. Capped at 3.
 *  @param answeredIds — IDs of questions already answered (skipped during refine)
 */
export function extractBlockingQuestions(results: RuleResult[], answeredIds?: Set<string>) {
  return results
    .filter(r => r.question?.blocking)
    .filter(r => !answeredIds || !answeredIds.has(r.question!.id))
    .map(r => r.question!)
    .slice(0, 3);
}

/** Extract assumptions from rule results. Capped at 5. */
export function extractAssumptions(results: RuleResult[]) {
  return results
    .filter(r => r.assumption)
    .map(r => r.assumption!)
    .slice(0, 5);
}

/** Determine if any rule elevates risk level. */
export function getElevatedRisk(results: RuleResult[]): RiskLevel | undefined {
  const elevations = results
    .filter(r => r.risk_elevation)
    .map(r => r.risk_elevation!);

  if (elevations.includes('high')) return 'high';
  if (elevations.includes('medium')) return 'medium';
  return undefined;
}
