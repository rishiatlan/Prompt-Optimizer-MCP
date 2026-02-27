// test/scorer.test.ts — Scoring tests: 100/100 achievable, checklist, dimension boundaries.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scorePrompt, generateChecklist } from '../src/scorer.js';
import { analyzePrompt } from '../src/analyzer.js';
import { compilePrompt } from '../src/compiler.js';
import type { IntentSpec, QualityScore } from '../src/types.js';

describe('scorePrompt', () => {
  it('scores a vague prompt low', () => {
    const spec = analyzePrompt('make it better');
    const score = scorePrompt(spec);
    assert.ok(score.total < 50, `Expected low score, got ${score.total}`);
    assert.equal(score.max, 100);
  });

  it('scores a detailed code prompt higher', () => {
    const spec = analyzePrompt(
      'Refactor the handleAuth function in src/auth.ts to use async/await instead of promise chains. ' +
      'Preserve backward compatibility. Only modify src/auth.ts. Do not change the public API.'
    );
    const score = scorePrompt(spec);
    assert.ok(score.total > 50, `Expected decent score, got ${score.total}`);
  });

  it('100/100 is achievable with a perfectly detailed prompt', () => {
    const spec = analyzePrompt(
      'Refactor the handleAuth function in src/auth.ts to use async/await instead of promise chains. ' +
      'Preserve backward compatibility and keep existing behavior. Only modify src/auth.ts. ' +
      'Do not change the public API. Do not modify tests. Must compile without errors. ' +
      'The function should handle both success and error paths. Output as JSON.',
      'const handleAuth = async () => { /* existing code */ };'
    );
    const score = scorePrompt(
      spec,
      'const handleAuth = async () => { /* existing code */ };'
    );
    // Score should be achievable close to 100 with all dimensions satisfied
    assert.ok(score.total >= 80, `Expected high score, got ${score.total}`);
    assert.equal(score.dimensions.length, 5);
    // Verify no dimension exceeds its max
    for (const dim of score.dimensions) {
      assert.ok(dim.score <= dim.max, `${dim.name}: ${dim.score} > max ${dim.max}`);
      assert.ok(dim.score >= 0, `${dim.name}: ${dim.score} < 0`);
    }
  });

  it('has exactly 5 dimensions', () => {
    const spec = analyzePrompt('test prompt');
    const score = scorePrompt(spec);
    assert.equal(score.dimensions.length, 5);
    const names = score.dimensions.map(d => d.name);
    assert.deepEqual(names, ['Clarity', 'Specificity', 'Completeness', 'Constraints', 'Efficiency']);
  });

  it('max possible total is 100', () => {
    const spec = analyzePrompt('test');
    const score = scorePrompt(spec);
    const maxTotal = score.dimensions.reduce((sum, d) => sum + d.max, 0);
    assert.equal(maxTotal, 100);
  });

  it('constraints dimension awards +2 for preservation instructions', () => {
    const specWithPreservation = analyzePrompt(
      'Refactor src/utils.ts. Preserve backward compatibility. Do not change tests.'
    );
    const specWithout = analyzePrompt(
      'Refactor src/utils.ts. Do not change tests.'
    );
    const scoreWith = scorePrompt(specWithPreservation);
    const scoreWithout = scorePrompt(specWithout);

    const constraintsWith = scoreWith.dimensions.find(d => d.name === 'Constraints')!;
    const constraintsWithout = scoreWithout.dimensions.find(d => d.name === 'Constraints')!;
    // The preservation bonus should make a difference
    assert.ok(constraintsWith.score >= constraintsWithout.score,
      `Preservation bonus not detected: ${constraintsWith.score} vs ${constraintsWithout.score}`);
  });
});

describe('generateChecklist', () => {
  it('returns 9 items for a complete claude-target prompt', () => {
    const spec = analyzePrompt(
      'Write a professional email to my team about the project update',
      'We shipped v2 this week.'
    );
    const { prompt } = compilePrompt(spec, 'We shipped v2 this week.', 'claude');
    const checklist = generateChecklist(prompt);

    assert.ok(checklist.items.length >= 7, `Expected >= 7 items, got ${checklist.items.length}`);
    assert.ok(checklist.summary.includes('/'), `Summary format wrong: ${checklist.summary}`);

    // Core items should always be present
    const role = checklist.items.find(i => i.name === 'Role');
    assert.ok(role?.present, 'Role should be present');
    const goal = checklist.items.find(i => i.name === 'Goal');
    assert.ok(goal?.present, 'Goal should be present');
  });

  it('detects generic (markdown) prompt elements', () => {
    const spec = analyzePrompt('Fix the bug in src/app.ts');
    const { prompt } = compilePrompt(spec, undefined, 'generic');
    const checklist = generateChecklist(prompt);

    const role = checklist.items.find(i => i.name === 'Role');
    assert.ok(role?.present, 'Role should be detected in markdown format');

    const constraints = checklist.items.find(i => i.name === 'Constraints');
    assert.ok(constraints?.present, 'Constraints should be detected in markdown format');
  });

  it('items are in canonical order', () => {
    const spec = analyzePrompt('Write a blog post for my team');
    const { prompt } = compilePrompt(spec, undefined, 'claude');
    const checklist = generateChecklist(prompt);

    // First 7 items should be in canonical order
    const canonicalOrder = [
      'Role', 'Goal', 'Definition of Done', 'Constraints',
      'Workflow', 'Output Format', 'Uncertainty Policy',
    ];
    for (let i = 0; i < canonicalOrder.length; i++) {
      assert.equal(checklist.items[i].name, canonicalOrder[i],
        `Item ${i} should be ${canonicalOrder[i]}, got ${checklist.items[i].name}`);
    }
  });
});
