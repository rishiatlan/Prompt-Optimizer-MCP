// templates.ts — Prompt templates for compiled output. XML-tagged, Anthropic-optimized.

import type { TaskType } from './types.js';

// ─── Role Mapping ─────────────────────────────────────────────────────────────

const ROLES: Record<TaskType, string> = {
  // Code roles
  code_change: 'an expert software engineer focused on making precise, minimal code changes',
  question: 'a knowledgeable technical advisor who gives clear, concise answers',
  review: 'a senior code reviewer who identifies issues and provides actionable feedback',
  debug: 'a systematic debugger who traces root causes methodically',
  create: 'a software architect and implementer who builds clean, well-structured code',
  refactor: 'a refactoring specialist who improves code structure while preserving behavior',
  // Non-code roles
  writing: 'a skilled writer who crafts clear, engaging content tailored to the audience and purpose',
  research: 'a thorough researcher who gathers evidence, compares options, and presents structured findings',
  planning: 'a strategic planner who breaks complex goals into actionable milestones with clear dependencies',
  analysis: 'an analytical thinker who extracts key insights from data and presents conclusions clearly',
  communication: 'a clear communicator who structures messages for maximum clarity and impact',
  data: 'a data specialist who transforms, cleans, and formats data accurately',
  other: 'a helpful assistant',
};

// ─── Workflow Templates ───────────────────────────────────────────────────────

const WORKFLOWS: Record<TaskType, string[]> = {
  code_change: [
    'Read and understand the relevant files and surrounding context',
    'Identify the minimal set of changes needed',
    'Implement changes, keeping the diff as small as possible',
    'Verify the changes satisfy the definition of done',
  ],
  question: [
    'Consider the question and relevant context',
    'Provide a clear, direct answer',
    'Include supporting evidence or examples where helpful',
  ],
  review: [
    'Read the code/content to be reviewed thoroughly',
    'Identify issues by severity (critical → minor)',
    'Provide specific, actionable feedback for each issue',
    'Summarize overall assessment and key recommendations',
  ],
  debug: [
    'Reproduce or understand the error/symptom from the description',
    'Trace the root cause through the code path',
    'Identify the fix and explain why it addresses the root cause',
    'Verify the fix does not introduce regressions',
  ],
  create: [
    'Understand the requirements and constraints',
    'Design the structure and key interfaces',
    'Implement the code in logical increments',
    'Verify completeness against the definition of done',
  ],
  refactor: [
    'Understand current behavior and ensure it is preserved',
    'Identify the structural improvements to make',
    'Apply changes incrementally, verifying behavior at each step',
    'Confirm the refactored code passes all existing tests',
  ],
  // Non-code workflows
  writing: [
    'Understand the purpose, audience, and tone',
    'Outline the key points and structure',
    'Draft the content, focusing on clarity and flow',
    'Review for tone consistency, readability, and completeness',
  ],
  research: [
    'Clarify the research question and scope',
    'Gather evidence from multiple sources',
    'Compare and evaluate findings for relevance and reliability',
    'Organize conclusions with supporting evidence',
  ],
  planning: [
    'Define the goal and success criteria',
    'Break down into milestones and actionable steps',
    'Identify dependencies, risks, and blockers',
    'Sequence steps and assign ownership where applicable',
  ],
  analysis: [
    'Understand the data or content to be analyzed',
    'Identify key patterns, trends, and outliers',
    'Draw conclusions supported by evidence',
    'Present findings in a clear, structured format',
  ],
  communication: [
    'Identify the audience and the core message',
    'Structure the message for scanability (lead with the key point)',
    'Add supporting details and context',
    'Review for clarity, tone, and actionability',
  ],
  data: [
    'Understand the input format and desired output',
    'Identify transformation rules and edge cases',
    'Apply transformations accurately',
    'Validate the output format and completeness',
  ],
  other: [
    'Understand the request and context',
    'Plan the approach',
    'Execute the task',
    'Verify the result matches expectations',
  ],
};

// ─── Public API ───────────────────────────────────────────────────────────────

export function getRole(taskType: TaskType): string {
  return ROLES[taskType];
}

export function getWorkflow(taskType: TaskType): string[] {
  return WORKFLOWS[taskType];
}
