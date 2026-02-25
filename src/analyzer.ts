// analyzer.ts — Intent decomposition: raw prompt → IntentSpec.

import type { IntentSpec, TaskType, RiskLevel } from './types.js';
import { isCodeTask, isProseTask } from './types.js';
import { runRules, extractBlockingQuestions, extractAssumptions, getElevatedRisk } from './rules.js';

// ─── Task Type Detection ──────────────────────────────────────────────────────
// PRIORITY: Non-code tasks are detected FIRST to prevent misclassification.
// A Slack post that mentions "fix the login bug" as an example should match
// 'writing' or 'communication', not 'debug'.

const TASK_TYPE_PATTERNS: Array<{ type: TaskType; patterns: RegExp[] }> = [
  // ── Non-code tasks (checked first) ──────────────────────────────────────
  {
    type: 'writing',
    patterns: [
      /\b(write|draft|compose|rewrite|edit|proofread|polish)\s+(a|an|the|my|this)?\s*(post|article|blog|essay|copy|email|message|announcement|doc|documentation|readme|report|proposal|brief|pitch|summary)\b/i,
      /\b(slack\s+post|slack\s+message|blog\s+post|press\s+release|newsletter|tweet|linkedin)\b/i,
      /\b(tone|voice|audience|readability|word\s*count|paragraph)\b/i,
    ],
  },
  {
    type: 'communication',
    patterns: [
      /\b(announce|share|present|pitch|notify|inform|update\s+(the\s+)?(team|group|channel|stakeholders|everyone))\b/i,
      /\b(meeting\s+notes|standup|status\s+update|weekly\s+update|retro|retrospective)\b/i,
    ],
  },
  {
    type: 'planning',
    patterns: [
      /\b(plan|design|architect|strategy|roadmap|outline|scope|spec|specification|proposal|rfc)\b/i,
      /\b(break\s+down|decompose|phase|milestone|timeline|prioriti[sz]e)\b/i,
    ],
  },
  {
    type: 'research',
    patterns: [
      /\b(research|investigate|compare|benchmark|evaluate|survey|explore|find\s+out|look\s+into)\b/i,
      /\b(pros?\s+and\s+cons?|trade-?offs?|alternatives?|options?|landscape)\b/i,
    ],
  },
  {
    type: 'data',
    patterns: [
      /\b(csv|spreadsheet|dataset|sql\s+query|data\s+(clean|transform|migrate|export|import))\b/i,
      /\b(pivot|aggregate|filter|group\s+by|join|merge)\b/i,
    ],
  },
  {
    type: 'analysis',
    patterns: [
      /\b(analy[sz]e|summari[sz]e|assess|digest|breakdown|report\s+on|insights?\s+from)\b/i,
      /\b(metrics?|data|trends?|patterns?|findings?|conclusions?)\b/i,
    ],
  },

  // ── Code tasks (checked second) ─────────────────────────────────────────
  {
    type: 'debug',
    patterns: [
      /\b(debug|diagnose|troubleshoot|why\s+is|not\s+working|broken|error|bug|crash|failing)\b/i,
    ],
  },
  {
    type: 'refactor',
    patterns: [
      /\b(refactor|restructure|reorganize|clean\s*up\s+(the\s+)?(code|function|class|module)|simplify|extract|decompose|decouple)\b/i,
    ],
  },
  {
    type: 'review',
    patterns: [
      /\b(code\s+review|review\s+(this|the)\s+(code|pr|pull\s+request|diff|commit))\b/i,
      /\b(audit\s+(the\s+)?(code|security|performance))\b/i,
    ],
  },
  {
    type: 'create',
    patterns: [
      /\b(create|build|scaffold|generate|set\s*up|bootstrap|initialize)\s+(a|an|the|my)?\s*(app|api|server|service|component|module|function|class|project|repo)\b/i,
    ],
  },
  {
    type: 'code_change',
    patterns: [
      /\b(add|implement|modify|change|update|edit|replace|remove|delete|rename|move)\s+(the\s+|a\s+|this\s+)?(function|class|method|variable|import|endpoint|route|handler|middleware|hook|component|type|interface)\b/i,
      /\b(add|implement|write)\s+(a|an|the)?\s*(test|spec|migration|endpoint|api|feature)\b/i,
      // Verb + file path pattern: "add X to src/file.ts" or "modify X in file.py"
      /\b(add|implement|modify|change|update|edit|remove|delete)\b.*\b[\w\-./]+\.(ts|js|tsx|jsx|py|go|rs|java|rb|css|html)\b/i,
      // Verb + function reference: "add X to the fetchData function"
      /\b(add|implement|modify|change|update)\b.*\b(to|in|for)\s+(the\s+)?\w+(function|method|class|handler|module|component)\b/i,
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

// ─── Audience Detection (for non-code tasks) ─────────────────────────────────

const AUDIENCE_PATTERNS = [
  /\b(for|to|with)\s+(my\s+)?(team|colleagues?|manager|stakeholders?|engineers?|designers?|leadership|exec|board|customers?|users?|clients?|public|community|audience)\b/i,
  /\b(internal|external|public|private)\s+(audience|post|announcement|message)\b/i,
  /\b(slack|email|blog|twitter|linkedin|newsletter|docs?|wiki)\b/i,
];

function detectAudience(prompt: string): string | undefined {
  for (const pattern of AUDIENCE_PATTERNS) {
    const match = prompt.match(pattern);
    if (match) return match[0];
  }
  return undefined;
}

// ─── Tone Detection (for non-code tasks) ──────────────────────────────────────

const TONE_PATTERNS = [
  /\b(casual|formal|professional|friendly|technical|simple|concise|detailed|persuasive|neutral|enthusiastic|serious)\b/i,
];

function detectTone(prompt: string): string | undefined {
  for (const pattern of TONE_PATTERNS) {
    const match = prompt.match(pattern);
    if (match) return match[0];
  }
  return undefined;
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
      // Non-code defaults
      case 'writing':
        items.push('Content is clear, well-structured, and matches the intended tone');
        items.push('Message achieves its communication goal');
        break;
      case 'communication':
        items.push('Message is clear and actionable for the audience');
        items.push('Key information is easy to scan');
        break;
      case 'research':
        items.push('Findings are organized and evidence-based');
        items.push('Sources are cited or identifiable');
        break;
      case 'planning':
        items.push('Plan has clear milestones and actionable steps');
        items.push('Dependencies and risks are identified');
        break;
      case 'analysis':
        items.push('Key insights are clearly stated');
        items.push('Data supports the conclusions');
        break;
      case 'data':
        items.push('Output format is correct and complete');
        items.push('Edge cases are handled');
        break;
      default:
        items.push('Task is completed as described');
    }
  }

  return items.slice(0, 5);
}

// ─── Constraint Extraction ────────────────────────────────────────────────────

function extractConstraints(prompt: string, taskType: TaskType): { scope: string[]; forbidden: string[]; time_budget?: string } {
  const scope: string[] = [];
  const forbidden: string[] = [];

  if (isCodeTask(taskType)) {
    // For code tasks: extract literal scope/forbidden constraints
    const onlyMatches = prompt.match(/\b(only|just)\s+(modify|change|touch|edit|update)\s+[^.!?\n]*/gi);
    if (onlyMatches) scope.push(...onlyMatches.map(m => m.trim()));

    const forbidMatches = prompt.match(/\b(don['']?t|do\s+not|never|avoid|must\s+not|should\s+not)\s+(touch|modify|change|edit|delete|remove)\s+[^.!?\n]*/gi);
    if (forbidMatches) forbidden.push(...forbidMatches.map(m => m.trim()));
  } else {
    // For non-code tasks: extract communication/content constraints
    const toneConstraints = prompt.match(/\b(keep\s+it|make\s+it|should\s+be)\s+(short|concise|brief|detailed|formal|casual|professional|simple|technical)\b[^.!?\n]*/gi);
    if (toneConstraints) scope.push(...toneConstraints.map(m => m.trim()));

    const lengthConstraints = prompt.match(/\b(under|within|max|maximum|at\s+most|no\s+more\s+than)\s+\d+\s*(words?|sentences?|paragraphs?|characters?|lines?|pages?)\b/gi);
    if (lengthConstraints) scope.push(...lengthConstraints.map(m => m.trim()));

    const avoidMatches = prompt.match(/\b(don['']?t|do\s+not|never|avoid|must\s+not|should\s+not|without)\s+(mention|include|use|reference|say|add)\s+[^.!?\n]*/gi);
    if (avoidMatches) forbidden.push(...avoidMatches.map(m => m.trim()));
  }

  // Time budget (universal)
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
    case 'writing':
      return 'Polished prose matching the intended tone and format';
    case 'communication':
      return 'Clear, scannable message formatted for the target platform';
    case 'research':
      return 'Structured findings with evidence and sources';
    case 'planning':
      return 'Actionable plan with milestones and dependencies';
    case 'analysis':
      return 'Structured analysis with key insights and supporting data';
    case 'data':
      return 'Clean, formatted data output';
    default:
      return 'Appropriate format for the task';
  }
}

// ─── Base Risk Assessment ─────────────────────────────────────────────────────

function assessBaseRisk(prompt: string, taskType: TaskType): RiskLevel {
  // Non-code tasks are inherently lower risk (no production systems affected)
  if (isProseTask(taskType)) return 'low';
  if (taskType === 'research' || taskType === 'analysis' || taskType === 'data') return 'low';
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

  // Run ambiguity rules — pass task type so rules can adapt
  const ruleResults = runRules(prompt, context, taskType);
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
    constraints: extractConstraints(prompt, taskType),
    output_format: detectOutputFormat(prompt, taskType),
    risk_level: riskLevel,
    assumptions: extractAssumptions(ruleResults),
    blocking_questions: extractBlockingQuestions(ruleResults),
  };
}
