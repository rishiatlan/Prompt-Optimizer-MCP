// test/compression-overloads.test.ts — Tests for compressContext overload resolution

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compressContext } from '../src/compiler.js';
import type { CompressionConfig, IntentSpec } from '../src/types.js';

describe('compressContext overload resolution', () => {
  const sampleContext =
    'import foo from "bar";\n' +
    'import baz from "qux";\n' +
    'import x from "y";\n' +
    'import a from "b";\n' +
    'import c from "d";\n' +
    'import e from "f";\n' +
    'import g from "h";\n' +
    '// test code here\n' +
    '// more test code\n' +
    'const result = doSomething();';

  it('overload 1: compressContext(context) with no intent', () => {
    const result = compressContext(sampleContext);
    assert.ok(result.compressed.length > 0);
    assert.ok(result.originalTokens > 0);
    assert.ok(result.compressedTokens <= result.originalTokens);
  });

  it('overload 2: compressContext(context, intentString)', () => {
    const result = compressContext(sampleContext, 'refactor the code');
    assert.ok(result.compressed.length > 0);
    assert.ok(result.originalTokens > 0);
  });

  it('overload 3: compressContext(context, intentSpec)', () => {
    const spec: IntentSpec = {
      user_intent: 'debug the function',
      goal: 'Fix the bug',
      definition_of_done: ['Bug fixed'],
      task_type: 'debug',
      inputs_detected: [],
      constraints: { scope: [], forbidden: [] },
      output_format: 'code',
      risk_level: 'low',
      assumptions: [],
      blocking_questions: [],
    };

    const result = compressContext(sampleContext, spec);
    assert.ok(result.compressed.length > 0);
    assert.ok(result.originalTokens > 0);
  });

  it('overload 4: compressContext(context, config)', () => {
    const config: CompressionConfig = {
      mode: 'aggressive',
      tokenBudget: 5000,
    };

    const result = compressContext(sampleContext, config);
    assert.ok(result.compressed.length > 0);
    assert.ok(result.originalTokens > 0);
  });

  it('overload 5: compressContext(context, intentString, config)', () => {
    const config: CompressionConfig = {
      mode: 'standard',
      preservePatterns: ['^const result'],
    };

    const result = compressContext(sampleContext, 'refactor the function', config);
    assert.ok(result.compressed.length > 0);
    assert.ok(result.originalTokens > 0);
  });

  it('overload 5b: compressContext(context, intentSpec, config)', () => {
    const spec: IntentSpec = {
      user_intent: 'optimize performance',
      goal: 'Make it faster',
      definition_of_done: ['Performance improved'],
      task_type: 'refactor',
      inputs_detected: [],
      constraints: { scope: [], forbidden: [] },
      output_format: 'code',
      risk_level: 'medium',
      assumptions: [],
      blocking_questions: [],
    };

    const config: CompressionConfig = {
      mode: 'standard',
      enableStubCollapse: false,
    };

    const result = compressContext(sampleContext, spec, config);
    assert.ok(result.compressed.length > 0);
    assert.ok(result.originalTokens > 0);
  });

  it('backwards compatibility: existing call compressContext(context, intent) still works', () => {
    const result = compressContext(sampleContext, 'write some code');
    assert.ok(result.compressed.length > 0);
    assert.ok(result.removed instanceof Array);
    assert.ok(typeof result.originalTokens === 'number');
    assert.ok(typeof result.compressedTokens === 'number');
  });

  it('G36 invariant: compressed tokens never exceed original tokens', () => {
    const result = compressContext(sampleContext, 'do something');
    assert.ok(result.compressedTokens <= result.originalTokens,
      `Compressed ${result.compressedTokens} should not exceed original ${result.originalTokens}`);
  });

  it('handles undefined config gracefully', () => {
    const result = compressContext(sampleContext, 'refactor', undefined);
    assert.ok(result.compressed.length > 0);
  });

  it('detects config vs intent correctly (config has mode field)', () => {
    const configLike: CompressionConfig = {
      mode: 'aggressive',
      tokenBudget: 2000,
    };
    const result = compressContext(sampleContext, configLike);
    assert.ok(result.compressedTokens <= result.originalTokens);
  });

  it('detects IntentSpec correctly (has user_intent field)', () => {
    const spec: any = {
      user_intent: 'add a feature',
      goal: 'Feature added',
      task_type: 'create',
      definition_of_done: ['Done'],
      constraints: { scope: [], forbidden: [] },
      output_format: 'code',
      risk_level: 'low',
      inputs_detected: [],
      assumptions: [],
      blocking_questions: [],
    };
    const result = compressContext(sampleContext, spec);
    assert.ok(result.compressedTokens <= result.originalTokens);
  });
});
