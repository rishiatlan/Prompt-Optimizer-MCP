// test/complexity.test.ts — Complexity classifier: 6 types, signals contract, determinism.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyComplexity } from '../src/analyzer.js';

// ─── Signals Contract (G12) ────────────────────────────────────────────────

describe('Signals contract (G12)', () => {
  it('signals are sorted alphabetically', () => {
    const result = classifyComplexity('What is TypeScript?');
    for (let i = 1; i < result.signals.length; i++) {
      assert.ok(result.signals[i - 1].localeCompare(result.signals[i]) <= 0,
        `Signals not sorted: "${result.signals[i - 1]}" should come before "${result.signals[i]}"`);
    }
  });

  it('signals are capped at 10', () => {
    // Long multi-part prompt to generate many signals
    const result = classifyComplexity(
      'First, use the MCP tool to analyze the code. Then compare options. ' +
      'After that, brainstorm creative solutions. Next, write the implementation. ' +
      'Finally, given this document, evaluate the results step by step.'
    );
    assert.ok(result.signals.length <= 10, `Signals count ${result.signals.length} exceeds 10`);
  });

  it('signals use key=value format only (no raw substrings)', () => {
    const result = classifyComplexity('Brainstorm creative ideas for a new product launch');
    for (const signal of result.signals) {
      assert.ok(/^[a-z_]+=/.test(signal),
        `Signal "${signal}" does not match key=value format`);
    }
  });

  it('deterministic: same input → same signals', () => {
    const prompt = 'Compare React vs Vue for a new project';
    const r1 = classifyComplexity(prompt);
    const r2 = classifyComplexity(prompt);
    assert.deepEqual(r1.signals, r2.signals);
    assert.equal(r1.complexity, r2.complexity);
    assert.equal(r1.confidence, r2.confidence);
  });
});

// ─── simple_factual ────────────────────────────────────────────────────────

describe('classifyComplexity: simple_factual', () => {
  it('short question → simple_factual', () => {
    const result = classifyComplexity('What is TypeScript?');
    assert.equal(result.complexity, 'simple_factual');
    assert.ok(result.confidence >= 70);
  });

  it('very short question → high confidence', () => {
    const result = classifyComplexity('What is REST?');
    assert.equal(result.complexity, 'simple_factual');
    assert.ok(result.confidence >= 85);
  });

  it('short how-to question → simple_factual', () => {
    const result = classifyComplexity('How do I install npm?');
    assert.equal(result.complexity, 'simple_factual');
  });
});

// ─── analytical ────────────────────────────────────────────────────────────

describe('classifyComplexity: analytical', () => {
  it('comparison prompt → analytical', () => {
    const result = classifyComplexity('Compare React vs Vue for building a dashboard');
    assert.equal(result.complexity, 'analytical');
    assert.ok(result.confidence >= 70);
  });

  it('evaluation prompt → analytical', () => {
    const result = classifyComplexity('Evaluate the trade-offs of using microservices vs monolith');
    assert.equal(result.complexity, 'analytical');
  });

  it('assessment prompt → analytical', () => {
    const result = classifyComplexity('Assess the pros and cons of serverless architecture');
    assert.equal(result.complexity, 'analytical');
  });
});

// ─── multi_step ────────────────────────────────────────────────────────────

describe('classifyComplexity: multi_step', () => {
  it('numbered steps → multi_step', () => {
    const result = classifyComplexity(
      '1. Create a new React component. 2. Add state management. 3. Write unit tests. 4. Update the documentation.'
    );
    assert.equal(result.complexity, 'multi_step');
    assert.ok(result.confidence >= 70);
  });

  it('sequential instructions → multi_step', () => {
    const result = classifyComplexity(
      'First, set up the database. Then create the API endpoints. After that, build the frontend. Finally, deploy to production.'
    );
    assert.equal(result.complexity, 'multi_step');
  });

  it('few steps should not trigger multi_step', () => {
    // Only 2 separators — below threshold
    const result = classifyComplexity('First do X, then do Y');
    assert.notEqual(result.complexity, 'multi_step');
  });
});

// ─── creative ──────────────────────────────────────────────────────────────

describe('classifyComplexity: creative', () => {
  it('brainstorm prompt → creative', () => {
    const result = classifyComplexity('Brainstorm creative ideas for a new product launch');
    assert.equal(result.complexity, 'creative');
    assert.ok(result.confidence >= 70);
  });

  it('ideation prompt → creative', () => {
    const result = classifyComplexity('Imagine a novel approach to user onboarding');
    assert.equal(result.complexity, 'creative');
  });

  it('creative with code refs → NOT creative (code task)', () => {
    // If code refs are present, creative loses priority
    const result = classifyComplexity('Brainstorm creative ideas for the fetchData() function');
    assert.notEqual(result.complexity, 'creative');
  });
});

// ─── long_context ──────────────────────────────────────────────────────────

describe('classifyComplexity: long_context', () => {
  it('explicit document reference → long_context', () => {
    const result = classifyComplexity('Given this document, summarize the key findings');
    assert.equal(result.complexity, 'long_context');
    assert.ok(result.confidence >= 70);
  });

  it('large context (>5K tokens) → long_context', () => {
    const bigContext = 'x '.repeat(12000); // ~6K tokens
    const result = classifyComplexity('Summarize the main points', bigContext);
    assert.equal(result.complexity, 'long_context');
    assert.ok(result.confidence >= 85);
  });

  it('small context should NOT trigger long_context', () => {
    const result = classifyComplexity('Summarize this', 'Short context here.');
    assert.notEqual(result.complexity, 'long_context');
  });
});

// ─── agent_orchestration ───────────────────────────────────────────────────

describe('classifyComplexity: agent_orchestration', () => {
  it('MCP tool reference → agent_orchestration', () => {
    const result = classifyComplexity('Use the MCP server to optimize the prompt and check costs');
    assert.equal(result.complexity, 'agent_orchestration');
    assert.ok(result.confidence >= 70);
  });

  it('tool/plugin reference → agent_orchestration', () => {
    const result = classifyComplexity('Use the search tool to find relevant documents, then summarize');
    assert.equal(result.complexity, 'agent_orchestration');
  });

  it('pipeline/workflow → agent_orchestration', () => {
    const result = classifyComplexity('Orchestrate the data pipeline to process incoming events');
    assert.equal(result.complexity, 'agent_orchestration');
  });

  it('agent_orchestration with code refs → higher confidence', () => {
    const result = classifyComplexity('Use the function_call API to invoke processData()');
    assert.equal(result.complexity, 'agent_orchestration');
    assert.ok(result.confidence >= 85);
  });
});

// ─── Confidence determinism ────────────────────────────────────────────────

describe('classifyComplexity: confidence determinism', () => {
  it('same prompt always produces same confidence', () => {
    const prompt = 'Compare the performance of PostgreSQL vs MySQL for read-heavy workloads';
    const results = Array.from({ length: 5 }, () => classifyComplexity(prompt));
    const confidences = results.map(r => r.confidence);
    assert.ok(confidences.every(c => c === confidences[0]),
      `Confidence should be deterministic, got: ${confidences}`);
  });
});
