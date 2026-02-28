// test/rules-v31.test.ts — Tests for 4 new v3.1.0 risk rules
// hallucination_risk, agent_underspec, conflicting_constraints, token_budget_mismatch

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runRules } from '../src/rules.js';

describe('Rule: hallucination_risk', () => {
  it('triggers when requesting exact facts without grounding', () => {
    const results = runRules('Give me the exact statistics about React adoption');
    const rule = results.find(r => r.rule_name === 'hallucination_risk');
    assert.ok(rule?.triggered, 'Should trigger on ungrounded fact request');
  });

  it('does not trigger when grounding context is provided', () => {
    const results = runRules('Based on this document, give me the exact number of users');
    const rule = results.find(r => r.rule_name === 'hallucination_risk');
    assert.ok(!rule || !rule.triggered, 'Should not trigger with grounding');
  });

  it('does not trigger on normal code prompts', () => {
    const results = runRules('Refactor src/auth.ts to use async/await', undefined, 'code_change');
    const rule = results.find(r => r.rule_name === 'hallucination_risk');
    assert.ok(!rule || !rule.triggered, 'Normal code prompt should not trigger');
  });

  it('elevates risk to medium when triggered', () => {
    const results = runRules('List all the facts about TypeScript adoption rates');
    const rule = results.find(r => r.rule_name === 'hallucination_risk');
    if (rule?.triggered) {
      assert.equal(rule.risk_elevation, 'medium');
    }
  });
});

describe('Rule: agent_underspec', () => {
  it('triggers on autonomous execution without constraints', () => {
    const results = runRules('Run this agent autonomously to fix all bugs');
    const rule = results.find(r => r.rule_name === 'agent_underspec');
    assert.ok(rule?.triggered, 'Should trigger on unguarded agent request');
  });

  it('does not trigger when constraints are provided', () => {
    const results = runRules('Run this agent autonomously but limit to 10 iterations and stop after errors');
    const rule = results.find(r => r.rule_name === 'agent_underspec');
    assert.ok(!rule || !rule.triggered, 'Should not trigger with constraints');
  });

  it('does not trigger on normal prompts without agent keywords', () => {
    const results = runRules('Write a function to calculate tax');
    const rule = results.find(r => r.rule_name === 'agent_underspec');
    assert.ok(!rule || !rule.triggered, 'Normal prompt should not trigger');
  });

  it('elevates risk to high when triggered', () => {
    const results = runRules('Deploy this autonomously across all servers');
    const rule = results.find(r => r.rule_name === 'agent_underspec');
    if (rule?.triggered) {
      assert.equal(rule.risk_elevation, 'high');
    }
  });

  it('produces a blocking question when triggered', () => {
    const results = runRules('Execute the agent autonomously');
    const rule = results.find(r => r.rule_name === 'agent_underspec');
    if (rule?.triggered) {
      assert.ok(rule.question?.blocking, 'Should produce blocking question');
    }
  });
});

describe('Rule: conflicting_constraints', () => {
  it('triggers on only-X + also-modify-Y contradiction', () => {
    const results = runRules('Only modify the auth module, also modify the database layer');
    const rule = results.find(r => r.rule_name === 'conflicting_constraints');
    assert.ok(rule?.triggered, 'Should detect scope contradiction');
  });

  it('does not trigger on non-contradictory constraints', () => {
    const results = runRules('Modify the auth module. Ensure tests pass. Do not touch the database.');
    const rule = results.find(r => r.rule_name === 'conflicting_constraints');
    assert.ok(!rule || !rule.triggered, 'Non-contradictory constraints should not trigger');
  });

  it('does not trigger on normal prompts', () => {
    const results = runRules('Write a blog post about React hooks');
    const rule = results.find(r => r.rule_name === 'conflicting_constraints');
    assert.ok(!rule || !rule.triggered, 'Normal prompt should not trigger');
  });

  it('produces a blocking question when triggered', () => {
    const results = runRules('Only modify the config, also modify the deployment scripts');
    const rule = results.find(r => r.rule_name === 'conflicting_constraints');
    if (rule?.triggered) {
      assert.ok(rule.question?.blocking, 'Should produce blocking question');
    }
  });
});

describe('Rule: token_budget_mismatch', () => {
  it('triggers when small model + large output requested', () => {
    const results = runRules('Using haiku, provide a comprehensive detailed analysis of the entire codebase');
    const rule = results.find(r => r.rule_name === 'token_budget_mismatch');
    assert.ok(rule?.triggered, 'Should detect budget mismatch');
  });

  it('does not trigger without model mention', () => {
    const results = runRules('Provide a comprehensive analysis of the codebase');
    const rule = results.find(r => r.rule_name === 'token_budget_mismatch');
    assert.ok(!rule || !rule.triggered, 'No model mention = no trigger');
  });

  it('does not trigger with small model + small output', () => {
    const results = runRules('Using haiku, fix the typo in README.md');
    const rule = results.find(r => r.rule_name === 'token_budget_mismatch');
    assert.ok(!rule || !rule.triggered, 'Small task + small model = no trigger');
  });

  it('does not trigger on normal prompts', () => {
    const results = runRules('Refactor the handleAuth function', undefined, 'code_change');
    const rule = results.find(r => r.rule_name === 'token_budget_mismatch');
    assert.ok(!rule || !rule.triggered, 'Normal prompt should not trigger');
  });

  it('provides an assumption when triggered', () => {
    const results = runRules('Use gpt-4o-mini for a thorough full audit of all modules');
    const rule = results.find(r => r.rule_name === 'token_budget_mismatch');
    if (rule?.triggered) {
      assert.ok(rule.assumption, 'Should provide assumption about truncation');
    }
  });
});

describe('v3.1.0 Rules: G21 Compatibility', () => {
  it('none of the golden fixture prompts trigger new rules with risk elevation', () => {
    const goldenPrompts = [
      'Write a blog post about React hooks for my team',
      'Refactor the handleAuth function to use async/await. Preserve backward compatibility.',
      'make it better',
      'Fix the bug in the authentication system',
      'Delete all user records from the production database where status = inactive',
      'Optimize the search query performance. Measure before and after. Document the changes.',
      'Refactor everything across the codebase to improve performance',
      'Add authentication to the API without breaking existing clients',
      'Research the latest trends in machine learning for 2025',
      'Update the payment processing logic to handle new card types',
    ];

    const newRuleNames = ['hallucination_risk', 'agent_underspec', 'conflicting_constraints', 'token_budget_mismatch'];

    for (const prompt of goldenPrompts) {
      const results = runRules(prompt);
      const newRuleResults = results.filter(r => newRuleNames.includes(r.rule_name));

      for (const result of newRuleResults) {
        if (result.risk_elevation) {
          assert.fail(
            `New rule "${result.rule_name}" elevated risk on golden fixture: "${prompt.substring(0, 40)}..."`
          );
        }
      }
    }
  });
});
