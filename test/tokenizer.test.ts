// test/tokenizer.test.ts — Tests for centralized token estimator

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimatePromptTokens,
  estimateToolTokens,
  estimateOutputTokens,
  areTokenEstimatesDeterministic,
} from '../src/tokenizer.js';

describe('estimatePromptTokens', () => {
  it('estimates tokens from word count × 1.3', () => {
    const text = 'write a function';
    const words = 3;
    const expected = Math.ceil(words * 1.3);
    const result = estimatePromptTokens(text);
    assert.equal(result, expected, `Expected ~${expected}, got ${result}`);
  });

  it('handles empty and undefined strings', () => {
    assert.equal(estimatePromptTokens(''), 0);
    assert.equal(estimatePromptTokens(undefined), 0);
  });

  it('is deterministic across multiple calls', () => {
    const text = 'Fix the authentication bug in src/auth.ts without breaking existing tests';
    const estimates = [
      estimatePromptTokens(text),
      estimatePromptTokens(text),
      estimatePromptTokens(text),
    ];
    assert.equal(estimates[0], estimates[1]);
    assert.equal(estimates[1], estimates[2]);
  });

  it('scales roughly linearly with text length', () => {
    const short = 'hello';
    const long = 'hello world foo bar baz qux quux corge grault garply waldo fred plugh xyzzy';
    const shortTokens = estimatePromptTokens(short);
    const longTokens = estimatePromptTokens(long);
    assert.ok(longTokens > shortTokens, 'Longer text should estimate to more tokens');
  });

  it('handles whitespace normalization', () => {
    const text1 = 'word1 word2 word3';
    const text2 = 'word1  word2   word3'; // extra spaces
    const text3 = '\n\tword1\nword2\n word3\n'; // mixed whitespace
    const tokens1 = estimatePromptTokens(text1);
    const tokens2 = estimatePromptTokens(text2);
    const tokens3 = estimatePromptTokens(text3);
    assert.equal(tokens1, tokens2);
    assert.equal(tokens2, tokens3);
  });

  it('estimates real-world prompts correctly', () => {
    const prompt =
      'Refactor the handleAuth function in src/auth.ts to use async/await instead of promise chains. ' +
      'Preserve backward compatibility. Only modify src/auth.ts. Do not change the public API.';
    const tokens = estimatePromptTokens(prompt);
    assert.ok(tokens > 20, `Expected >20 tokens, got ${tokens}`);
    assert.ok(tokens < 100, `Expected <100 tokens, got ${tokens}`);
  });
});

describe('estimateToolTokens', () => {
  it('estimates tokens from character count ÷ 4', () => {
    const definition = 'name: "tool1", description: "does something", schema: {...}';
    const expected = Math.ceil(definition.length / 4);
    const result = estimateToolTokens(definition);
    assert.equal(result, expected);
  });

  it('handles empty and undefined strings', () => {
    assert.equal(estimateToolTokens(''), 0);
    assert.equal(estimateToolTokens(undefined), 0);
  });

  it('differs from prompt token estimation', () => {
    const text = 'hello world tool definition here';
    const promptTokens = estimatePromptTokens(text);
    const toolTokens = estimateToolTokens(text);
    assert.notEqual(
      promptTokens,
      toolTokens,
      'Tool tokens (chars/4) should differ from prompt tokens (words×1.3)'
    );
  });
});

describe('estimateOutputTokens', () => {
  it('estimates output tokens as input × maxRatio (default 0.5)', () => {
    const input = 100;
    const expected = Math.ceil(input * 0.5);
    const result = estimateOutputTokens(input);
    assert.equal(result, expected);
  });

  it('respects custom maxRatio parameter', () => {
    const input = 100;
    const ratio = 0.8;
    const expected = Math.ceil(input * ratio);
    const result = estimateOutputTokens(input, ratio);
    assert.equal(result, expected);
  });

  it('clamps to zero for zero input', () => {
    assert.equal(estimateOutputTokens(0), 0);
  });
});

describe('areTokenEstimatesDeterministic', () => {
  it('returns true when estimates are consistent', () => {
    const text = 'Write a summary of the project status';
    const isDeterministic = areTokenEstimatesDeterministic(text);
    assert.equal(isDeterministic, true);
  });

  it('allows custom iteration count', () => {
    const text = 'test text';
    const isDeterministic = areTokenEstimatesDeterministic(text, 10);
    assert.equal(isDeterministic, true);
  });
});
