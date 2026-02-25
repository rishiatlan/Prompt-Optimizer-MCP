// analyzer.ts — Intent decomposition: raw prompt → IntentSpec.

import type { IntentSpec, TaskType, RiskLevel } from './types.js';
import { runRules, extractBlockingQuestions, extractAssumptions, getElevatedRisk } from './rules.js';

// ─── Task Type Detection ──────────────────────────────────────────────────────

const TASK_TYPE_PATTERNS: Array<{ type: TaskType; patterns: RegExp[] }> = [
  {
    type: 'debug',
    patterns: [
      /\b(debug|diagnose|troubleshoot|investigate|why\s+is|not\s+working|broken|error|bug|crash|failing)\b/i,
    ],
  },
  {
    type: 'refactor',
    patterns: [
      /\b(refactor|restructure|reorganize|clean\s*up|simplify|extract|decompose|decouple)\b/i,
    ],
  },
  {
    type: 'review',
    patterns: [
      /\b(review|audit|check|evaluate|assess|analyze|look\s+at|examine)\b/i,
    ],
  },
  {
    type: 'create',
    patterns: [
      /\b(create|build|scaffold|generate|set\s*up|bootstrap|initialize|new)\b/i,
    ],
  },
  {
    type: 'code_change',
    patterns: [
      /\b(add|implement|write|modify|change|update|edit|replace|remove|delete|rename|move)\b/i,
    ],
  },
  {
    type: 'question',
    patterns: [
      /\b(explain|what\s+is|how\s+does|why\s+does|where\s+is|can\s+you\s+tell|describe|show\s+me)\b/i,
      /\?$/m,
    ],
  },
];

function detectTaskType(prompt: string): TaskType {
  for (const { type, patterns } of TASK_TYPE_PATTERNS) {
    if (patterns.some(p => p.test(prompt))) return type;
  }
  return 'other';
}

// ─── Input Detection ──────────────────────────────────────────────────────────

const FILE_EXTENSIONS = /\b([\w\-./]+\.(ts|js|tsx|jsx|py|go|rs|java|rb|css|html|json|yaml|yml|md|sql|sh|toml|cfg|env|lock))\b/g;
const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
const CODE_BLOCKS = /```[\s\S]*?```/g;

function detectInputs(prompt: string): string[] {
  const inputs: string[] = [];
  const files = prompt.match(FILE_EXTENSIONS);
  if (files) inputs.push(...files);
  const urls = prompt.match(URL_PATTERN);
  if (urls) inputs.push(...urls);
  if (CODE_BLOCKS.test(prompt)) inputs.push('[inline code block]');
  return [...new Set(inputs)];
}

// ─── Goal Extraction ──────────────────────────────────────────────────────────

function extractGoal(prompt: string): string {
  // Take the first sentence as goal. If it's too long, truncate.
  const sentences = prompt.split(/[.!?\n]/).filter(s => s.trim().length > 5);
  const first = sentences[0]?.trim() || prompt.trim();
  return first.length > 200 ? first.slice(0, 200) + '...' : first;
}

// ─── Definition of Done ──────────────────────────────────────────────────────

function extractDefinitionOfDone(prompt: string, taskType: TaskType): string[] {
  const items: string[] = [];

  // Look for explicit success criteria
  const criteriaMatch = prompt.match(/\b(should|must|needs?\s+to|expected\s+to|make\s+sure)\b[^.!?\n]*/gi);
  if (criteriaMatch) {
    items.push(...criteriaMatch.map(m => m.trim()));
  }

  // Add task-type-specific defaults if none found
  if (items.length === 0) {
    switch (taskType) {
      case 'code_change':
      case 'create':
        items.push('Code compiles without errors');
        items.push('Changes are minimal and focused');
        break;
      case 'refactor':
        items.push('Behavior is preserved (no functional changes)');
        items.push('Code compiles without errors');
        break;
      case 'debug':
        items.push('Root cause is identified');
        items.push('Fix addresses the root cause, not just symptoms');
        break;
      case 'review':
        items.push('Key findings are clearly listed');
        items.push('Actionable recommendations provided');
        break;
      case 'question':
        items.push('Answer is clear and specific');
        break;
      default:
        items.push('Task is completed as described');
    }
  }

  return items.slice(0, 5);
}

// ─── Constraint Extraction ────────────────────────────────────────────────────

function extractConstraints(prompt: string): { scope: string[]; forbidden: string[]; time_budget?: string } {
  const scope: string[] = [];
  const forbidden: string[] = [];

  // "only" / "just" → scope
  const onlyMatches = prompt.match(/\b(only|just)\s+[^.!?\n]*/gi);
  if (onlyMatches) scope.push(...onlyMatches.map(m => m.trim()));

  // "don't" / "do not" / "never" / "avoid" → forbidden
  const forbidMatches = prompt.match(/\b(don['']?t|do\s+not|never|avoid|must\s+not|should\s+not|without)\s+[^.!?\n]*/gi);
  if (forbidMatches) forbidden.push(...forbidMatches.map(m => m.trim()));

  // Time budget
  const timeMatch = prompt.match(/\b(within|under|in\s+less\s+than|at\s+most)\s+(\d+\s*(minutes?|hours?|mins?|hrs?))\b/i);

  return {
    scope: scope.slice(0, 5),
    forbidden: forbidden.slice(0, 5),
    time_budget: timeMatch ? timeMatch[0] : undefined,
  };
}

// ─── Output Format Detection ──────────────────────────────────────────────────

function detectOutputFormat(prompt: string, taskType: TaskType): string {
  if (/\bjson\b/i.test(prompt)) return 'JSON';
  if (/\byaml\b/i.test(prompt)) return 'YAML';
  if (/\bmarkdown\b|\bmd\b/i.test(prompt)) return 'Markdown';
  if (/\btable\b/i.test(prompt)) return 'Table';
  if (/\blist\b/i.test(prompt)) return 'Bulleted list';

  // Task-type defaults
  switch (taskType) {
    case 'code_change':
    case 'create':
    case 'refactor':
    case 'debug':
      return 'Code changes with brief explanation';
    case 'review':
      return 'Structured analysis with findings and recommendations';
    case 'question':
      return 'Clear, concise answer';
    default:
      return 'Appropriate format for the task';
  }
}

// ─── Base Risk Assessment ─────────────────────────────────────────────────────

function assessBaseRisk(prompt: string, taskType: TaskType): RiskLevel {
  if (taskType === 'question' || taskType === 'review') return 'low';
  if (taskType === 'create') return 'medium';
  // Code changes default to medium
  return 'medium';
}

// ─── Main Analyzer ────────────────────────────────────────────────────────────

/** Decompose a raw prompt into a structured IntentSpec. */
export function analyzePrompt(prompt: string, context?: string): IntentSpec {
  const taskType = detectTaskType(prompt);
  const baseRisk = assessBaseRisk(prompt, taskType);

  // Run ambiguity rules
  const ruleResults = runRules(prompt, context);
  const elevatedRisk = getElevatedRisk(ruleResults);
  const riskLevel = elevatedRisk
    ? (elevatedRisk === 'high' || baseRisk === 'high' ? 'high' : elevatedRisk)
    : baseRisk;

  return {
    user_intent: prompt,
    goal: extractGoal(prompt),
    definition_of_done: extractDefinitionOfDone(prompt, taskType),
    task_type: taskType,
    inputs_detected: detectInputs(prompt),
    constraints: extractConstraints(prompt),
    output_format: detectOutputFormat(prompt, taskType),
    risk_level: riskLevel,
    assumptions: extractAssumptions(ruleResults),
    blocking_questions: extractBlockingQuestions(ruleResults),
  };
}
