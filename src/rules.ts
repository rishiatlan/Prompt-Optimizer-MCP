// rules.ts — Deterministic ambiguity detection rules. No LLM calls.

import type { RuleResult, RiskLevel } from './types.js';

// ─── Rule Definitions ─────────────────────────────────────────────────────────

interface Rule {
  name: string;
  check: (prompt: string, context?: string) => RuleResult;
}

// Vague terms without a specific target
const VAGUE_PATTERNS = [
  /\bmake\s+it\s+(better|work|good|nice|faster|cleaner)\b/i,
  /\b(improve|enhance|optimize|update|change|fix|tweak)\b(?!.*\b(in|at|for|the file|function|class|module|component)\b)/i,
  /\bdo\s+something\s+(about|with)\b/i,
  /\bhandle\s+this\b/i,
];

// File path patterns
const FILE_PATH_PATTERNS = [
  /\b[\w\-./]+\.(ts|js|tsx|jsx|py|go|rs|java|rb|css|html|json|yaml|yml|md|sql|sh)\b/,
  /\b(src|lib|app|pages|components|utils|test|spec)\//,
  /\.\//,
];

// Function/class references
const CODE_REF_PATTERNS = [
  /\b(function|class|method|interface|type|enum|const|let|var|def|fn)\s+\w+/i,
  /\b\w+\(\)/,
  /\b\w+\.\w+\(/,
];

// Scope explosion keywords — allow scoping nouns within a short window after "all"/"every"/etc.
const SCOPE_EXPLOSION = [
  /\b(everything|entire|whole)\b(?![\w\s]{0,25}\b(files?|functions?|class(?:es)?|tests?|modules?|components?|endpoints?|routes?)\b)/i,
  /\b(all|every)\b(?![\w\s]{0,25}\b(files?|functions?|class(?:es)?|tests?|modules?|components?|endpoints?|routes?|the)\b)/i,
  /\bacross\s+the\s+(codebase|project|repo)\b/i,
];

// High-risk domain keywords
const HIGH_RISK_KEYWORDS = [
  /\b(auth|authentication|authorization|login|password|credential|secret|token|api[_\s]?key)\b/i,
  /\b(payment|billing|invoice|credit\s*card|stripe|transaction|checkout)\b/i,
  /\b(database|migration|schema|drop|truncate|delete\s+from|alter\s+table)\b/i,
  /\b(production|prod|deploy|release|publish|live)\b/i,
  /\b(delete|remove|destroy|purge|wipe|reset)\b/i,
  /\b(security|encryption|certificate|ssl|tls|cors|csrf|xss|injection)\b/i,
];

// Format references without schema
const FORMAT_REFS = [
  /\b(json|yaml|xml|csv|graphql)\b/i,
  /\breturn\s+(a|the)?\s*(json|object|array|list|table|schema)\b/i,
];

// Task separators (multiple tasks in one prompt)
const TASK_SEPARATORS = [
  /\b(also|and\s+also|additionally|plus|on\s+top\s+of\s+that|while\s+you['']?re\s+at\s+it)\b/i,
  /\b(first|second|third|then|after\s+that|next|finally)\b/i,
  /\d+\.\s+\w/g, // numbered lists like "1. Do X"
];

// ─── Rule Implementations ─────────────────────────────────────────────────────

const rules: Rule[] = [
  {
    name: 'vague_objective',
    check(prompt) {
      const hasVague = VAGUE_PATTERNS.some(p => p.test(prompt));
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
    check(prompt) {
      const isCodeTask = /\b(code|implement|build|write|create|add|remove|refactor|fix|debug|test)\b/i.test(prompt);
      const hasTarget = FILE_PATH_PATTERNS.some(p => p.test(prompt))
        || CODE_REF_PATTERNS.some(p => p.test(prompt))
        || /\b(the|this|that)\s+(component|module|service|page|endpoint|route|handler|hook|util)\b/i.test(prompt);

      return {
        rule_name: 'missing_target',
        severity: 'blocking',
        triggered: isCodeTask && !hasTarget,
        message: 'Code task detected but no target file, function, or module specified.',
        question: isCodeTask && !hasTarget ? {
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
    check(prompt) {
      const hasExplosion = SCOPE_EXPLOSION.some(p => p.test(prompt));
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
    name: 'format_ambiguity',
    check(prompt) {
      const mentionsFormat = FORMAT_REFS.some(p => p.test(prompt));
      const hasSchema = /\b(schema|structure|shape|fields?|columns?|properties)\b/i.test(prompt)
        || /\{[\s\S]*:[\s\S]*\}/.test(prompt); // inline JSON-like structure

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
    name: 'high_risk_domain',
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

  {
    name: 'multi_task_overload',
    check(prompt) {
      let taskCount = 0;
      for (const pattern of TASK_SEPARATORS) {
        const matches = prompt.match(pattern);
        if (matches) taskCount += matches.length;
      }
      // Heuristic: 3+ task separators suggests multiple distinct tasks
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
];

// ─── Public API ───────────────────────────────────────────────────────────────

/** Run all ambiguity rules against a prompt. Returns triggered results only. */
export function runRules(prompt: string, context?: string): RuleResult[] {
  return rules
    .map(rule => rule.check(prompt, context))
    .filter(result => result.triggered);
}

/** Extract blocking questions from rule results. Capped at 3. */
export function extractBlockingQuestions(results: RuleResult[]) {
  return results
    .filter(r => r.question?.blocking)
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
