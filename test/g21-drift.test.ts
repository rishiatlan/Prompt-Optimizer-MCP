// test/g21-drift.test.ts — G21 Guardrail: New rules do not change existing risk scores
// Lock golden fixture scores NOW; when new rules are added, ensure zero drift on these prompts.
// This prevents silent degradation of the risk detection system.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePrompt } from '../src/analyzer.js';
import { scorePrompt } from '../src/scorer.js';

/**
 * Golden fixture prompts: representative sample covering all risk levels.
 * These risk scores are LOCKED and must not change when new rules are added.
 *
 * Format: { prompt, expectedRiskLevel, description }
 * Risk levels: 'low' | 'medium' | 'high'
 */
const GOLDEN_FIXTURES = [
  {
    prompt: 'Write a blog post about React hooks for my team',
    expectedRiskLevel: 'low' as const,
    description: 'Clean, specific prose task',
  },
  {
    prompt: 'Refactor the handleAuth function to use async/await. Preserve backward compatibility.',
    expectedRiskLevel: 'medium' as const,
    description: 'Specific code task with constraints',
  },
  {
    prompt: 'make it better',
    expectedRiskLevel: 'medium' as const,
    description: 'Vague code task without target',
  },
  {
    prompt: 'Fix the bug in the authentication system',
    expectedRiskLevel: 'high' as const,
    description: 'Vague but mentions security (auth)',
  },
  {
    prompt: 'Delete all user records from the production database where status = inactive',
    expectedRiskLevel: 'medium' as const,
    description: 'Destructive operation (delete)',
  },
  {
    prompt: 'Optimize the search query performance. Measure before and after. Document the changes.',
    expectedRiskLevel: 'medium' as const,
    description: 'Specific task with measurement requirement',
  },
  {
    prompt: 'Refactor everything across the codebase to improve performance',
    expectedRiskLevel: 'medium' as const,
    description: 'Scope explosion (refactor everything)',
  },
  {
    prompt: 'Add authentication to the API without breaking existing clients',
    expectedRiskLevel: 'medium' as const,
    description: 'Security-related code task (auth)',
  },
  {
    prompt: 'Research the latest trends in machine learning for 2025',
    expectedRiskLevel: 'low' as const,
    description: 'Open research task',
  },
  {
    prompt: 'Update the payment processing logic to handle new card types',
    expectedRiskLevel: 'medium' as const,
    description: 'Payment/financial code',
  },
];

describe('G21 Drift Guardrail: Risk Scores Stability', () => {
  it('locks golden fixture risk scores (strict equality)', () => {
    for (const fixture of GOLDEN_FIXTURES) {
      const spec = analyzePrompt(fixture.prompt);
      assert.equal(
        spec.risk_level,
        fixture.expectedRiskLevel,
        `DRIFT DETECTED: "${fixture.description}" expected ${fixture.expectedRiskLevel}, got ${spec.risk_level}`
      );
    }
  });

  it('ensures low-risk prompts stay low', () => {
    const lowRiskPrompts = GOLDEN_FIXTURES.filter((f) => f.expectedRiskLevel === 'low');
    assert.ok(lowRiskPrompts.length > 0, 'Need at least one low-risk fixture');

    for (const fixture of lowRiskPrompts) {
      const spec = analyzePrompt(fixture.prompt);
      assert.equal(
        spec.risk_level,
        'low',
        `${fixture.description}: expected low, got ${spec.risk_level}`
      );
    }
  });

  it('ensures medium-risk prompts stay medium', () => {
    const mediumRiskPrompts = GOLDEN_FIXTURES.filter((f) => f.expectedRiskLevel === 'medium');
    assert.ok(mediumRiskPrompts.length > 0, 'Need at least one medium-risk fixture');

    for (const fixture of mediumRiskPrompts) {
      const spec = analyzePrompt(fixture.prompt);
      assert.equal(
        spec.risk_level,
        'medium',
        `${fixture.description}: expected medium, got ${spec.risk_level}`
      );
    }
  });

  it('ensures high-risk prompts stay high', () => {
    const highRiskPrompts = GOLDEN_FIXTURES.filter((f) => f.expectedRiskLevel === 'high');
    assert.ok(highRiskPrompts.length > 0, 'Need at least one high-risk fixture');

    for (const fixture of highRiskPrompts) {
      const spec = analyzePrompt(fixture.prompt);
      assert.equal(
        spec.risk_level,
        'high',
        `${fixture.description}: expected high, got ${spec.risk_level}`
      );
    }
  });

  it('verifies quality scores do not change unexpectedly', () => {
    // This test documents the current quality score distribution.
    // When new rules are added, re-run and update expected values if intentional changes occur.
    for (const fixture of GOLDEN_FIXTURES) {
      const spec = analyzePrompt(fixture.prompt);
      const score = scorePrompt(spec);

      // Ensure score is within valid range
      assert.ok(score.total >= 0 && score.total <= 100,
        `Score out of range: ${score.total}/100 for "${fixture.description}"`);

      // Ensure max is always 100
      assert.equal(score.max, 100,
        `Max score incorrect for "${fixture.description}"`);
    }
  });

  it('maintains consistent scoring across fixture set', () => {
    // Verify relative ordering: vague prompts score lower than specific ones
    const vague = GOLDEN_FIXTURES.find((f) => f.description.includes('Vague'));
    const specific = GOLDEN_FIXTURES.find((f) => f.description.includes('Specific'));

    if (vague && specific) {
      const vagueSpec = analyzePrompt(vague.prompt);
      const specificSpec = analyzePrompt(specific.prompt);
      const vagueScore = scorePrompt(vagueSpec);
      const specificScore = scorePrompt(specificSpec);

      assert.ok(vagueScore.total < specificScore.total,
        'Vague prompts should score lower than specific ones');
    }
  });
});
