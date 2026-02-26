// scorer.ts — Prompt quality scoring (0-100). Pure function, no MCP imports.
// Task-type aware: code tasks reward file paths, prose tasks reward audience/tone.

import type { IntentSpec, QualityScore, QualityDimension } from './types.js';
import { isCodeTask, isProseTask } from './types.js';
import { estimateTokens } from './estimator.js';

// ─── Vague terms that reduce clarity ──────────────────────────────────────────

const VAGUE_TERMS = [
  /\bmake\s+it\s+(better|work|good|nice|faster|cleaner)\b/i,
  /\b(improve|enhance|optimize)\b(?!.*\b(in|at|for)\b)/i,
  /\bdo\s+something\b/i,
  /\bfix\s+it\b/i,
  /\bsomehow\b/i,
  /\bwhatever\b/i,
  /\bstuff\b/i,
  /\betc\.?\b/i,
];

// ─── Scoring Functions ────────────────────────────────────────────────────────

function scoreClarity(spec: IntentSpec): QualityDimension {
  let score = 20;
  const notes: string[] = [];

  // Penalize vague terms
  let vagueCount = 0;
  for (const pattern of VAGUE_TERMS) {
    if (pattern.test(spec.user_intent)) vagueCount++;
  }
  const vagueDeduction = Math.min(vagueCount * 5, 15);
  score -= vagueDeduction;
  if (vagueCount > 0) notes.push(`${vagueCount} vague term(s) detected (-${vagueDeduction})`);

  // Reward clear goal
  if (spec.goal.length > 20 && spec.goal.length < 200) {
    notes.push('Goal is well-scoped');
  } else if (spec.goal.length <= 20) {
    score -= 5;
    notes.push('Goal is very short — may be too terse (-5)');
  }

  return { name: 'Clarity', score: Math.max(0, score), max: 20, notes };
}

function scoreSpecificity(spec: IntentSpec): QualityDimension {
  let score = 5; // Start lower, earn points
  const notes: string[] = [];

  if (isCodeTask(spec.task_type)) {
    // ── Code tasks: reward file paths, code blocks, URLs ──
    const fileCount = spec.inputs_detected.filter(i => !i.startsWith('http') && i !== '[inline code block]').length;
    const fileBonus = Math.min(fileCount * 5, 10);
    score += fileBonus;
    if (fileCount > 0) notes.push(`${fileCount} file path(s) referenced (+${fileBonus})`);

    if (spec.inputs_detected.includes('[inline code block]')) {
      score += 3;
      notes.push('Inline code provided (+3)');
    }

    const urlCount = spec.inputs_detected.filter(i => i.startsWith('http')).length;
    if (urlCount > 0) {
      score += 2;
      notes.push(`${urlCount} URL(s) provided (+2)`);
    }
  } else {
    // ── Non-code tasks: reward audience, tone, platform, length constraints ──
    const prompt = spec.user_intent;

    // Audience specified?
    if (/\b(for|to)\s+(my\s+)?(team|colleagues?|manager|stakeholders?|engineers?|designers?|leadership|customers?|users?|clients?|public|community|audience|everyone)\b/i.test(prompt)) {
      score += 5;
      notes.push('Target audience specified (+5)');
    }

    // Tone specified?
    if (/\b(casual|formal|professional|friendly|technical|simple|concise|detailed|persuasive|neutral|enthusiastic|serious|conversational)\b/i.test(prompt)) {
      score += 4;
      notes.push('Tone/style specified (+4)');
    }

    // Platform/medium specified?
    if (/\b(slack|email|blog|twitter|linkedin|newsletter|docs?|wiki|presentation|meeting|standup)\b/i.test(prompt)) {
      score += 3;
      notes.push('Platform/medium specified (+3)');
    }

    // Length constraint?
    if (/\b(short|brief|concise|one[\s-]?liner|paragraph|under\s+\d+\s*words?|max\s+\d+)\b/i.test(prompt)) {
      score += 3;
      notes.push('Length constraint specified (+3)');
    }

    // Key points / examples mentioned?
    if (/\b(include|mention|cover|highlight|reference|example)\b/i.test(prompt)) {
      score += 2;
      notes.push('Specific content requirements mentioned (+2)');
    }
  }

  return { name: 'Specificity', score: Math.min(20, score), max: 20, notes };
}

function scoreCompleteness(spec: IntentSpec): QualityDimension {
  let score = 5;
  const notes: string[] = [];

  // Reward explicit success criteria (filter out all default DoD items)
  const DEFAULT_DOD_PREFIXES = [
    'Code compiles', 'Changes are minimal', 'Behavior is preserved',
    'Root cause', 'Key findings', 'Actionable recommendations',
    'Answer is', 'Task is',
    // Non-code defaults
    'Content is clear', 'Message is clear', 'Message achieves',
    'Key information', 'Findings are organized', 'Sources are cited',
    'Plan has clear', 'Dependencies and risks', 'Key insights',
    'Data supports', 'Output format is correct', 'Edge cases',
  ];
  const explicitDoDCount = spec.definition_of_done.filter(d =>
    !DEFAULT_DOD_PREFIXES.some(prefix => d.startsWith(prefix))
  ).length;

  if (explicitDoDCount >= 2) {
    score += 10;
    notes.push(`${explicitDoDCount} explicit success criteria (+10)`);
  } else if (explicitDoDCount === 1) {
    score += 5;
    notes.push('1 explicit success criterion (+5)');
  } else {
    notes.push('No explicit success criteria (defaults applied)');
  }

  // Reward having a clear task type (not 'other')
  if (spec.task_type !== 'other') {
    score += 3;
    notes.push(`Task type detected: ${spec.task_type} (+3)`);
  }

  // Reward output format specification
  if (/JSON|YAML|Markdown|Table|list/i.test(spec.output_format)) {
    score += 2;
    notes.push('Output format specified (+2)');
  }

  return { name: 'Completeness', score: Math.min(20, score), max: 20, notes };
}

function scoreConstraints(spec: IntentSpec): QualityDimension {
  let score = 5;
  const notes: string[] = [];

  if (spec.constraints.scope.length > 0) {
    score += 5;
    notes.push(`${spec.constraints.scope.length} scope constraint(s) (+5)`);
  }

  if (spec.constraints.forbidden.length > 0) {
    score += 5;
    notes.push(`${spec.constraints.forbidden.length} forbidden action(s) (+5)`);
  }

  if (spec.constraints.time_budget) {
    score += 3;
    notes.push('Time budget specified (+3)');
  }

  // Penalize high risk with no constraints
  if (spec.risk_level === 'high' && spec.constraints.scope.length === 0 && spec.constraints.forbidden.length === 0) {
    score -= 5;
    notes.push('High-risk task with no constraints (-5)');
  }

  if (spec.constraints.scope.length === 0 && spec.constraints.forbidden.length === 0) {
    notes.push('No constraints specified');
  }

  return { name: 'Constraints', score: Math.max(0, Math.min(20, score)), max: 20, notes };
}

function scoreEfficiency(prompt: string, context?: string): QualityDimension {
  let score = 18; // Start high, penalize bloat
  const notes: string[] = [];

  const totalText = prompt + (context || '');
  const tokens = estimateTokens(totalText);

  // Penalize excessive length
  if (tokens > 5000) {
    const penalty = Math.min(Math.floor((tokens - 5000) / 1000) * 2, 12);
    score -= penalty;
    notes.push(`~${tokens} tokens total — large context (-${penalty})`);
  } else if (tokens > 2000) {
    const penalty = Math.min(Math.floor((tokens - 2000) / 1000) * 1, 6);
    score -= penalty;
    notes.push(`~${tokens} tokens — moderate size (-${penalty})`);
  } else {
    notes.push(`~${tokens} tokens — efficient`);
  }

  // Penalize repetition (crude: check for duplicate sentences)
  const sentences = totalText.split(/[.!?\n]/).map(s => s.trim().toLowerCase()).filter(s => s.length > 20);
  const uniqueSentences = new Set(sentences);
  if (sentences.length - uniqueSentences.size > 2) {
    score -= 4;
    notes.push('Repetitive content detected (-4)');
  }

  return { name: 'Efficiency', score: Math.max(0, Math.min(20, score)), max: 20, notes };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Score a prompt's quality based on its IntentSpec. Returns 0-100. */
export function scorePrompt(spec: IntentSpec, context?: string): QualityScore {
  const dimensions = [
    scoreClarity(spec),
    scoreSpecificity(spec),
    scoreCompleteness(spec),
    scoreConstraints(spec),
    scoreEfficiency(spec.user_intent, context),
  ];

  return {
    total: dimensions.reduce((sum, d) => sum + d.score, 0),
    max: 100,
    dimensions,
  };
}

/** Score a compiled prompt (uses a synthetic IntentSpec optimized for max score). */
export function scoreCompiledPrompt(compiledPrompt: string): QualityScore {
  // Compiled prompts are structured by design, so score the structural completeness
  const dimensions: QualityDimension[] = [];

  // Clarity: compiled prompts always have a clear goal
  const hasGoal = /<goal>/.test(compiledPrompt);
  dimensions.push({
    name: 'Clarity',
    score: hasGoal ? 19 : 12,
    max: 20,
    notes: hasGoal ? ['Explicit goal tag present'] : ['No goal tag found'],
  });

  // Specificity: check for context, role, audience, tone, platform
  const hasRole = /<role>/.test(compiledPrompt);
  const hasContext = /<context>/.test(compiledPrompt);
  const hasAudience = /<audience>/.test(compiledPrompt);
  const hasTone = /<tone>/.test(compiledPrompt);
  const hasPlatform = /<platform_guidelines/.test(compiledPrompt);
  let specScore = 10;
  const specNotes: string[] = [];
  if (hasRole) { specScore += 3; specNotes.push('Role defined (+3)'); }
  if (hasContext) { specScore += 3; specNotes.push('Context provided (+3)'); }
  if (hasAudience) { specScore += 4; specNotes.push('Audience specified (+4)'); }
  if (hasTone) { specScore += 3; specNotes.push('Tone specified (+3)'); }
  if (hasPlatform) { specScore += 3; specNotes.push('Platform guidelines included (+3)'); }
  dimensions.push({ name: 'Specificity', score: Math.min(20, specScore), max: 20, notes: specNotes });

  // Completeness: check for DoD, workflow, output format
  const hasDod = /<definition_of_done>/.test(compiledPrompt);
  const hasWorkflow = /<workflow>/.test(compiledPrompt);
  const hasFormat = /<output_format>/.test(compiledPrompt);
  let compScore = 5;
  const compNotes: string[] = [];
  if (hasDod) { compScore += 6; compNotes.push('Definition of done present (+6)'); }
  if (hasWorkflow) { compScore += 5; compNotes.push('Workflow steps defined (+5)'); }
  if (hasFormat) { compScore += 4; compNotes.push('Output format specified (+4)'); }
  dimensions.push({ name: 'Completeness', score: Math.min(20, compScore), max: 20, notes: compNotes });

  // Constraints: check for constraints and uncertainty policy
  const hasConstraints = /<constraints>/.test(compiledPrompt);
  const hasUncertainty = /<uncertainty_policy>/.test(compiledPrompt);
  let conScore = 5;
  const conNotes: string[] = [];
  if (hasConstraints) { conScore += 8; conNotes.push('Constraints defined (+8)'); }
  if (hasUncertainty) { conScore += 5; conNotes.push('Uncertainty policy set (+5)'); }
  dimensions.push({ name: 'Constraints', score: Math.min(20, conScore), max: 20, notes: conNotes });

  // Efficiency: compiled prompts are structured, start high
  const tokens = estimateTokens(compiledPrompt);
  dimensions.push({
    name: 'Efficiency',
    score: tokens > 3000 ? 14 : 18,
    max: 20,
    notes: [`~${tokens} tokens in compiled prompt`],
  });

  return {
    total: dimensions.reduce((sum, d) => sum + d.score, 0),
    max: 100,
    dimensions,
  };
}
