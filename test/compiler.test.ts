// test/compiler.test.ts — Multi-LLM compilation: claude, openai, generic targets.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compilePrompt, compressContext } from '../src/compiler.js';
import { analyzePrompt } from '../src/analyzer.js';

describe('compilePrompt', () => {
  const spec = analyzePrompt('Refactor the handleAuth function in src/auth.ts');

  it('compiles to XML-tagged format for claude target', () => {
    const result = compilePrompt(spec, undefined, 'claude');
    assert.ok(result.prompt.includes('<role>'), 'Should have XML <role> tag');
    assert.ok(result.prompt.includes('<goal>'), 'Should have XML <goal> tag');
    assert.ok(result.prompt.includes('<constraints>'), 'Should have XML <constraints> tag');
    assert.ok(result.prompt.includes('<workflow>'), 'Should have XML <workflow> tag');
    assert.ok(result.prompt.includes('<output_format>'), 'Should have XML <output_format> tag');
    assert.ok(result.prompt.includes('<uncertainty_policy>'), 'Should have XML <uncertainty_policy> tag');
    assert.equal(result.format_version, 1);
  });

  it('compiles to system/user split for openai target', () => {
    const result = compilePrompt(spec, undefined, 'openai');
    assert.ok(result.prompt.includes('[SYSTEM]'), 'Should have [SYSTEM] section');
    assert.ok(result.prompt.includes('[USER]'), 'Should have [USER] section');
    assert.ok(result.prompt.includes('Constraints:'), 'System should contain constraints');
    assert.ok(result.prompt.includes('Goal:'), 'User should contain goal');
    assert.equal(result.format_version, 1);
  });

  it('compiles to markdown for generic target', () => {
    const result = compilePrompt(spec, undefined, 'generic');
    assert.ok(result.prompt.includes('## Role'), 'Should have markdown ## Role');
    assert.ok(result.prompt.includes('## Goal'), 'Should have markdown ## Goal');
    assert.ok(result.prompt.includes('## Constraints'), 'Should have markdown ## Constraints');
    assert.ok(result.prompt.includes('## Workflow'), 'Should have markdown ## Workflow');
    assert.ok(result.prompt.includes('## Output Format'), 'Should have markdown ## Output');
    assert.ok(result.prompt.includes('## Uncertainty Policy'), 'Should have markdown ## Uncertainty');
    assert.equal(result.format_version, 1);
  });

  it('defaults to claude when no target specified', () => {
    const result = compilePrompt(spec);
    assert.ok(result.prompt.includes('<role>'), 'Default should be XML-tagged');
    assert.equal(result.format_version, 1);
  });

  it('includes format_version: 1 in all outputs', () => {
    for (const target of ['claude', 'openai', 'generic'] as const) {
      const result = compilePrompt(spec, undefined, target);
      assert.equal(result.format_version, 1, `format_version missing for ${target}`);
    }
  });

  it('never includes blocking questions in compiled output', () => {
    const vagueSpec = analyzePrompt('make it better');
    for (const target of ['claude', 'openai', 'generic'] as const) {
      const result = compilePrompt(vagueSpec, undefined, target);
      assert.ok(!result.prompt.includes('blocking_question'), `Blocking questions leaked into ${target} output`);
      assert.ok(!result.prompt.includes('q_vague'), `Question IDs leaked into ${target} output`);
    }
  });

  it('includes context when provided', () => {
    const ctx = 'const x = 42; // existing code';
    for (const target of ['claude', 'openai', 'generic'] as const) {
      const result = compilePrompt(spec, ctx, target);
      assert.ok(result.prompt.includes('const x = 42'), `Context missing in ${target}`);
    }
  });

  it('returns non-empty changes array', () => {
    const result = compilePrompt(spec, undefined, 'claude');
    assert.ok(result.changes.length > 0, 'Should have changes');
    assert.ok(result.changes.every(c => typeof c === 'string'), 'Changes should be strings');
  });
});

describe('compressContext', () => {
  it('removes large comment blocks', () => {
    const ctx = '/* ' + 'x'.repeat(300) + ' */\nconst x = 1;';
    const result = compressContext(ctx, 'fix the bug');
    assert.ok(result.removed.length > 0, 'Should have removed sections');
    assert.ok(result.compressed.includes('const x = 1'), 'Should keep code');
  });

  it('reports token savings', () => {
    const ctx = 'line\n\n\n\n\n\nline';
    const result = compressContext(ctx, 'test');
    assert.ok(result.originalTokens >= result.compressedTokens);
  });
});
