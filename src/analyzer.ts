// analyzer.ts — Intent decomposition: raw prompt → IntentSpec.

import type { IntentSpec, TaskType, RiskLevel } from './types.js';
import { isCodeTask, isProseTask } from './types.js';
import { runRules, extractBlockingQuestions, extractAssumptions, getElevatedRisk } from './rules.js';

// ─── Prose Output Types ──────────────────────────────────────────────────────
// Comprehensive list of non-code output types. Used by intent-first detection
// AND full-prompt pattern matching. Keep in sync.

const PROSE_OUTPUT_TYPES = [
  // Common documents
  'post', 'article', 'blog', 'blog\\s+post', 'essay', 'copy', 'email',
  'message', 'announcement', 'letter', 'memo', 'brief', 'newsletter',
  // Reports & proposals
  'report', 'proposal', 'summary', 'executive\\s+summary', 'one[- ]pager',
  'abstract', 'overview', 'blurb', 'description',
  // Technical writing (prose, not code)
  'doc', 'documentation', 'readme', 'guide', 'tutorial', 'faq',
  'changelog', 'release\\s+notes',
  // Communication
  'pitch', 'presentation', 'speech', 'talking\\s+points', 'script',
  'response', 'reply', 'comment', 'review',
  // Social & professional
  'tweet', 'bio', 'introduction', 'intro',
  // Meeting artifacts
  'minutes', 'recap', 'digest', 'notes',
  // Professional
  'cover\\s+letter',
].join('|');

const PROSE_OUTPUT_RE = new RegExp(`\\b(${PROSE_OUTPUT_TYPES})\\b`, 'i');

// ─── Intent-First Detection ─────────────────────────────────────────────────
// The opening phrase is the strongest signal of user intent. A prompt that
// starts with "Write me a LinkedIn post" is WRITING — even if the rest of
// the prompt is saturated with technical keywords like "server", "API", "MCP".
// This prevents topic-vs-task confusion.

const WRITING_VERBS = /\b(write|draft|compose|rewrite|edit|proofread|polish|craft|prepare|put\s+together|summarize|create|generate)\b/i;
const RESEARCH_VERBS = /^(research|compare|investigate|benchmark|evaluate|explore)\b/i;
const PLANNING_NOUNS = /\b(plan|roadmap|strategy|timeline|proposal|rfc|outline|schedule|budget)\b/i;
const CODE_ARTIFACT_NOUNS = /\b(app|api|server|service|component|module|function|class|project|repo|library|package|tool|system|endpoint|cli|sdk|bot|worker|lambda|pipeline|daemon)\b/i;

// Platform signals — if the opener mentions these, it's prose not code
const PLATFORM_SIGNALS = /\b(linkedin|medium|substack|twitter|slack|x\.com|notion|confluence|wiki|google\s+docs?|blog)\b/i;

function detectIntentFromOpener(prompt: string): TaskType | null {
  // Take first sentence or first 150 chars, whichever is shorter
  const sentenceEnd = prompt.search(/[.!?\n]/);
  const limit = Math.min(sentenceEnd > 0 ? sentenceEnd : 150, 150);
  const opener = prompt.slice(0, limit);

  // ── Writing intent ────────────────────────────────────────────────────
  // "Write/Draft/Compose [me/us] a [prose type]"
  // "Summarize X into a report"
  // "Create a blog post about..."
  if (WRITING_VERBS.test(opener)) {
    // Check if the output is a prose type (not a code artifact)
    if (PROSE_OUTPUT_RE.test(opener)) {
      // Guard: "Create a server" should NOT match writing
      // Only block if a code artifact noun is present AND no prose noun is
      if (!CODE_ARTIFACT_NOUNS.test(opener)) {
        return 'writing';
      }
      // If BOTH are present (e.g. "Write a guide for the API server"),
      // the prose noun wins — it's still writing
      return 'writing';
    }
    // Platform signal: "Write a LinkedIn post..." even without matching a prose noun
    if (PLATFORM_SIGNALS.test(opener)) {
      return 'writing';
    }
  }

  // ── Research intent ───────────────────────────────────────────────────
  // "Research X", "Compare X vs Y", "Investigate..."
  if (RESEARCH_VERBS.test(opener)) {
    return 'research';
  }

  // ── Planning intent ───────────────────────────────────────────────────
  // "Create a roadmap..." (not "Create a server")
  if (/\b(create|build|design|develop|make)\b/i.test(opener)) {
    if (PLANNING_NOUNS.test(opener) && !CODE_ARTIFACT_NOUNS.test(opener)) {
      return 'planning';
    }
  }

  return null; // No strong opening intent — fall through to full-prompt patterns
}

// ─── Task Type Detection ──────────────────────────────────────────────────────
// Three-layer detection:
//   Layer 1: Intent-first (opening phrase) — strongest signal, prevents topic contamination
//   Layer 2: Full-prompt pattern matching — catches everything else
//   Layer 3: Fallback to 'other'

const TASK_TYPE_PATTERNS: Array<{ type: TaskType; patterns: RegExp[] }> = [
  // ── Non-code tasks (checked first) ──────────────────────────────────────
  {
    type: 'writing',
    patterns: [
      // Pattern 1: Verb + [me/us] + article + prose noun
      // Handles: "Write a post", "Write me a post", "Draft us a report"
      new RegExp(`\\b(write|draft|compose|rewrite|edit|proofread|polish|craft|prepare|summarize)\\s+(?:(?:me|us|them|him|her)\\s+)?(?:a|an|the|my|this)?\\s*(?:\\w+\\s+){0,2}(${PROSE_OUTPUT_TYPES})\\b`, 'i'),
      // Pattern 2: Platform keywords — if any appear, it's a writing task
      /\b(slack\s+(?:post|message)|blog\s+post|press\s+release|newsletter|tweet|linkedin(?:\s+post)?|medium\s+(?:article|post)|substack(?:\s+post)?|twitter\s+(?:thread|post)|x\s+(?:thread|post)|notion\s+page|confluence\s+page|wiki\s+page|google\s+doc|github\s+(?:issue|pr)\s+description)\b/i,
      // Pattern 3: Tone/style signals — strong indicator of prose task
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
      /\b(create|build|scaffold|generate|set\s*up|bootstrap|initialize)\s+(?:a|an|the|my)?\s*(?:\w+\s+){0,2}(app|api|server|service|component|module|function|class|project|repo)\b/i,
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
  // Layer 1: Opening intent — strongest signal, prevents topic contamination
  const openerIntent = detectIntentFromOpener(prompt);
  if (openerIntent) return openerIntent;

  // Layer 2: Full-prompt pattern matching
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

const AUDIENCE_MAP: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(for|to)\s+(my\s+)?team\b/i, label: 'team (internal)' },
  { pattern: /\b(for|to)\s+(my\s+)?colleagues?\b/i, label: 'colleagues (internal)' },
  { pattern: /\b(for|to)\s+(my\s+)?manager\b/i, label: 'manager' },
  { pattern: /\b(for|to)\s+(the\s+)?stakeholders?\b/i, label: 'stakeholders' },
  { pattern: /\b(for|to)\s+(the\s+)?leadership\b/i, label: 'leadership / executives' },
  { pattern: /\b(for|to)\s+(the\s+)?(exec|board)\b/i, label: 'executives' },
  { pattern: /\b(for|to)\s+(the\s+)?engineers?\b/i, label: 'engineers (technical)' },
  { pattern: /\b(for|to)\s+(the\s+)?designers?\b/i, label: 'designers' },
  { pattern: /\b(for|to)\s+(the\s+)?developers?\b/i, label: 'developers (technical)' },
  { pattern: /\b(for|to)\s+(the\s+)?customers?\b/i, label: 'customers (external)' },
  { pattern: /\b(for|to)\s+(the\s+)?clients?\b/i, label: 'clients (external)' },
  { pattern: /\b(for|to)\s+(the\s+)?users?\b/i, label: 'end users' },
  { pattern: /\b(for|to)\s+(the\s+)?public\b/i, label: 'general public' },
  { pattern: /\b(for|to)\s+(the\s+)?community\b/i, label: 'community' },
  { pattern: /\b(for|to)\s+(the\s+)?everyone\b/i, label: 'general audience' },
  { pattern: /\binternal\s+(audience|post|announcement|message)\b/i, label: 'internal audience' },
  { pattern: /\bexternal\s+(audience|post|announcement|message)\b/i, label: 'external audience' },
  { pattern: /\btechnical\s+PMs?\b/i, label: 'technical PMs' },
  { pattern: /\bnon[- ]?technical\b/i, label: 'non-technical audience' },
];

function detectAudience(prompt: string): string | undefined {
  for (const { pattern, label } of AUDIENCE_MAP) {
    if (pattern.test(prompt)) return label;
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

// ─── Platform Detection (for non-code tasks) ────────────────────────────────

const PLATFORM_MAP: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bslack\b/i, label: 'Slack' },
  { pattern: /\blinkedin\b/i, label: 'LinkedIn' },
  { pattern: /\bblog\s*(?:post)?\b/i, label: 'Blog' },
  { pattern: /\btwitter\b|\bx\.com\b/i, label: 'Twitter/X' },
  { pattern: /\bmedium\b|\bsubstack\b/i, label: 'Medium/Substack' },
  { pattern: /\bemail\b/i, label: 'Email' },
  { pattern: /\bnewsletter\b/i, label: 'Newsletter' },
  { pattern: /\bwiki\b|\bconfluence\b|\bnotion\b/i, label: 'Wiki' },
  { pattern: /\bpresentation\b|\bslides?\b/i, label: 'Presentation' },
];

function detectPlatform(prompt: string): string | undefined {
  for (const { pattern, label } of PLATFORM_MAP) {
    if (pattern.test(prompt)) return label;
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

/** Decompose a raw prompt into a structured IntentSpec.
 *  @param answeredQuestionIds — IDs of blocking questions already answered (for refine flow)
 */
export function analyzePrompt(prompt: string, context?: string, answeredQuestionIds?: Set<string>): IntentSpec {
  const taskType = detectTaskType(prompt);
  const baseRisk = assessBaseRisk(prompt, taskType);

  // Run ambiguity rules — pass task type so rules can adapt
  const ruleResults = runRules(prompt, context, taskType);
  const elevatedRisk = getElevatedRisk(ruleResults);
  const riskLevel = elevatedRisk
    ? (elevatedRisk === 'high' || baseRisk === 'high' ? 'high' : elevatedRisk)
    : baseRisk;

  const audience = detectAudience(prompt);
  const tone = detectTone(prompt);
  const platform = detectPlatform(prompt);

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
    blocking_questions: extractBlockingQuestions(ruleResults, answeredQuestionIds),
    audience,
    tone,
    platform,
  };
}
