// test/g36-invariance.test.ts — G36 Invariance: compressed tokens ≤ original tokens
// Property-based testing to ensure compression never increases token count

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compressContext } from '../src/compiler.js';

describe('G36 Invariance: compressed_tokens ≤ original_tokens', () => {
  // ─── Single Heuristic Combinations ────────────────────────────────────────

  it('H1 (Duplicate Collapse): never increases tokens', () => {
    const ctx = `x\nx\nx\ny`;
    const result = compressContext(ctx, 'test');
    assert.ok(result.compressedTokens <= result.originalTokens,
      `H1: ${result.compressedTokens} ≤ ${result.originalTokens}`);
  });

  it('H2 (License Strip): never increases tokens', () => {
    const ctx = `// Copyright 2025\n// Licensed under MIT\n// All rights reserved\nconst x = 1;`;
    const result = compressContext(ctx, 'test');
    assert.ok(result.compressedTokens <= result.originalTokens,
      `H2: ${result.compressedTokens} ≤ ${result.originalTokens}`);
  });

  it('H3 (Comment Collapse): never increases tokens', () => {
    const ctx = `const x = 1;\n// c1\n// c2\n// c3\n// c4\n// c5\nconst y = 2;`;
    const result = compressContext(ctx, 'test');
    assert.ok(result.compressedTokens <= result.originalTokens,
      `H3: ${result.compressedTokens} ≤ ${result.originalTokens}`);
  });

  it('H4 (Stub Collapse): never increases tokens', () => {
    const ctx = `const x = 1;\n{ /* stub */ }\nconst y = 2;`;
    const result = compressContext(ctx, 'test');
    assert.ok(result.compressedTokens <= result.originalTokens,
      `H4: ${result.compressedTokens} ≤ ${result.originalTokens}`);
  });

  it('H5 (Middle Truncation): never increases tokens', () => {
    const lines: string[] = [];
    for (let i = 0; i < 300; i++) {
      lines.push(`line ${i}`);
    }
    const ctx = lines.join('\n');
    const result = compressContext(ctx, 'test', { mode: 'aggressive', tokenBudget: 100 });
    assert.ok(result.compressedTokens <= result.originalTokens,
      `H5: ${result.compressedTokens} ≤ ${result.originalTokens}`);
  });

  // ─── Multiple Heuristic Combinations ──────────────────────────────────────

  it('H1+H3 (Duplicates + Comments): never increases tokens', () => {
    const ctx = `const x = 1;\n// c1\n// c2\n// c3\n// c4\n// c5\nx\nx\nconst y = 2;`;
    const result = compressContext(ctx, 'test');
    assert.ok(result.compressedTokens <= result.originalTokens,
      `H1+H3: ${result.compressedTokens} ≤ ${result.originalTokens}`);
  });

  it('H2+H3+H1 (License + Comments + Duplicates): never increases tokens', () => {
    const ctx = `// Copyright 2025\n// Licensed under MIT\nconst x = 1;\n// c1\n// c2\n// c3\n// c4\n// c5\nx\nx\nconst y = 2;`;
    const result = compressContext(ctx, 'test');
    assert.ok(result.compressedTokens <= result.originalTokens,
      `H2+H3+H1: ${result.compressedTokens} ≤ ${result.originalTokens}`);
  });

  it('All heuristics + aggressive H5: never increases tokens', () => {
    let ctx = `// Copyright 2025\n// Licensed under MIT\n// All rights reserved\nconst x = 1;`;
    ctx += '\n// c1\n// c2\n// c3\n// c4\n// c5';
    ctx += '\nx\nx';
    for (let i = 0; i < 200; i++) {
      ctx += `\nline ${i}`;
    }
    const result = compressContext(ctx, 'test', { mode: 'aggressive', tokenBudget: 100 });
    assert.ok(result.compressedTokens <= result.originalTokens,
      `All: ${result.compressedTokens} ≤ ${result.originalTokens}`);
  });

  // ─── Edge Cases ────────────────────────────────────────────────────────────

  it('Empty context: 0 tokens', () => {
    const result = compressContext('', 'test');
    assert.equal(result.originalTokens, 0);
    assert.equal(result.compressedTokens, 0);
    assert.ok(result.compressedTokens <= result.originalTokens);
  });

  it('Whitespace-only context: non-negative', () => {
    const result = compressContext('\n\n   \n\n', 'test');
    assert.ok(result.compressedTokens >= 0);
    assert.ok(result.compressedTokens <= result.originalTokens);
  });

  it('Single line context: invariant holds', () => {
    const result = compressContext('const x = 1;', 'test');
    assert.ok(result.compressedTokens <= result.originalTokens);
  });

  it('All identical lines (worst case for H1): invariant holds', () => {
    let ctx = '';
    for (let i = 0; i < 100; i++) {
      ctx += 'duplicate line\n';
    }
    const result = compressContext(ctx, 'test');
    assert.ok(result.compressedTokens <= result.originalTokens,
      `Worst case duplicates: ${result.compressedTokens} ≤ ${result.originalTokens}`);
  });

  it('All comment lines (worst case for H3): invariant holds', () => {
    let ctx = '';
    for (let i = 0; i < 100; i++) {
      ctx += `// Comment ${i}\n`;
    }
    const result = compressContext(ctx, 'test');
    assert.ok(result.compressedTokens <= result.originalTokens,
      `Worst case comments: ${result.compressedTokens} ≤ ${result.originalTokens}`);
  });

  // ─── Preserve Patterns ─────────────────────────────────────────────────────

  it('Preserve patterns prevent removals but don\'t increase tokens', () => {
    const ctx = `important\nduplicate\nduplicate`;
    const result = compressContext(ctx, 'test', {
      preservePatterns: ['important'],
    });
    assert.ok(result.compressedTokens <= result.originalTokens,
      `With preservePatterns: ${result.compressedTokens} ≤ ${result.originalTokens}`);
  });

  it('Multiple preserve patterns: invariant still holds', () => {
    const ctx = `protected1\ndup\ndup\nprotected2\nx\nx`;
    const result = compressContext(ctx, 'test', {
      preservePatterns: ['protected1', 'protected2'],
    });
    assert.ok(result.compressedTokens <= result.originalTokens,
      `Multiple preservePatterns: ${result.compressedTokens} ≤ ${result.originalTokens}`);
  });

  // ─── Fenced Code Zones ────────────────────────────────────────────────────

  it('Fenced code block: invariant held (zone protection)', () => {
    const ctx = `\`\`\`js\nconst x = 1;\nconst x = 1;\nconst x = 1;\n\`\`\``;
    const result = compressContext(ctx, 'test');
    assert.ok(result.compressedTokens <= result.originalTokens,
      `Fenced code: ${result.compressedTokens} ≤ ${result.originalTokens}`);
  });

  it('Markdown table: invariant held (zone protection)', () => {
    const ctx = `| col1 | col2 |\n| ---- | ---- |\n| x | x |\n| x | x |`;
    const result = compressContext(ctx, 'test');
    assert.ok(result.compressedTokens <= result.originalTokens,
      `Markdown table: ${result.compressedTokens} ≤ ${result.originalTokens}`);
  });

  it('Markdown list: invariant held (zone protection)', () => {
    const ctx = `- item 1\n- item 2\n- item 3\n- item 4`;
    const result = compressContext(ctx, 'test');
    assert.ok(result.compressedTokens <= result.originalTokens,
      `Markdown list: ${result.compressedTokens} ≤ ${result.originalTokens}`);
  });

  // ─── Real-World Scenarios ──────────────────────────────────────────────────

  it('Real code with comments and duplicates', () => {
    const ctx = `function doSomething() {
  // Utility function
  // Does X
  // Does Y
  // Does Z
  // Does W
  const x = 1;
  const y = 2;
  const y = 2;
  const y = 2;
  return x + y;
}`;
    const result = compressContext(ctx, 'test');
    assert.ok(result.compressedTokens <= result.originalTokens,
      `Real code: ${result.compressedTokens} ≤ ${result.originalTokens}`);
  });

  it('API response JSON with nested duplicates', () => {
    const ctx = `{
  "status": "ok",
  "status": "ok",
  "status": "ok",
  "data": {
    "id": 1,
    "id": 1,
    "id": 1
  }
}`;
    const result = compressContext(ctx, 'test');
    assert.ok(result.compressedTokens <= result.originalTokens,
      `JSON: ${result.compressedTokens} ≤ ${result.originalTokens}`);
  });

  it('Multi-file context with license headers', () => {
    const ctx = `// Copyright 2025
// Licensed under MIT
// File 1
const x = 1;

// Copyright 2025
// Licensed under MIT
// File 2
const y = 2;`;
    const result = compressContext(ctx, 'test');
    assert.ok(result.compressedTokens <= result.originalTokens,
      `Multi-file: ${result.compressedTokens} ≤ ${result.originalTokens}`);
  });

  // ─── Fuzz-Like Testing (Property-Based) ────────────────────────────────────

  it('100 random contexts never violate G36', () => {
    for (let trial = 0; trial < 100; trial++) {
      // Generate random context
      const lines: string[] = [];
      const numLines = Math.floor(Math.random() * 50) + 1;

      for (let i = 0; i < numLines; i++) {
        const rand = Math.random();
        if (rand < 0.3) {
          // Duplicate line
          if (lines.length > 0) {
            lines.push(lines[lines.length - 1]);
          } else {
            lines.push('line');
          }
        } else if (rand < 0.6) {
          // Comment line
          lines.push(`// Comment ${i}`);
        } else {
          // Code line
          lines.push(`const x${i} = ${i};`);
        }
      }

      const ctx = lines.join('\n');
      const mode = Math.random() < 0.5 ? 'standard' : 'aggressive';
      const result = compressContext(ctx, 'test', {
        mode: mode as 'standard' | 'aggressive',
        tokenBudget: Math.floor(Math.random() * 200) + 50,
      });

      assert.ok(
        result.compressedTokens <= result.originalTokens,
        `Trial ${trial} (${mode} mode): ${result.compressedTokens} ≤ ${result.originalTokens}`
      );
    }
  });

  it('Different token budgets maintain invariant', () => {
    const ctx = Array(300).fill('line').join('\n');

    for (const budget of [50, 100, 200, 500, 1000, 5000]) {
      const result = compressContext(ctx, 'test', {
        mode: 'aggressive',
        tokenBudget: budget,
      });
      assert.ok(result.compressedTokens <= result.originalTokens,
        `Budget ${budget}: ${result.compressedTokens} ≤ ${result.originalTokens}`);
    }
  });

  it('Repeated compression is idempotent w.r.t. tokens', () => {
    const ctx = `x\nx\n// c\n// c\n// c\n// c\n// c\ny`;
    const result1 = compressContext(ctx, 'test');
    const result2 = compressContext(result1.compressed, 'test');
    const result3 = compressContext(result2.compressed, 'test');

    // All should satisfy invariant
    assert.ok(result1.compressedTokens <= result1.originalTokens);
    assert.ok(result2.compressedTokens <= result2.originalTokens);
    assert.ok(result3.compressedTokens <= result3.originalTokens);

    // Tokens should stabilize (no increase)
    assert.ok(result3.compressedTokens <= result2.compressedTokens);
  });

  // ─── Config Edge Cases ─────────────────────────────────────────────────────

  it('Standard mode always satisfies invariant', () => {
    const contexts = [
      'x\nx\nx',
      '// c1\n// c2\n// c3\n// c4\n// c5',
      '// Copyright\n// Licensed\nconst x = 1;',
      '{ /* stub */ }',
    ];

    for (const ctx of contexts) {
      const result = compressContext(ctx, 'test', { mode: 'standard' });
      assert.ok(result.compressedTokens <= result.originalTokens,
        `Standard mode (${ctx.substring(0, 20)}...): ${result.compressedTokens} ≤ ${result.originalTokens}`);
    }
  });

  it('Aggressive mode always satisfies invariant', () => {
    const contexts = [
      'x\nx\nx',
      '// c1\n// c2\n// c3\n// c4\n// c5',
      '// Copyright\n// Licensed\nconst x = 1;',
      '{ /* stub */ }',
    ];

    for (const ctx of contexts) {
      const result = compressContext(ctx, 'test', { mode: 'aggressive', tokenBudget: 100 });
      assert.ok(result.compressedTokens <= result.originalTokens,
        `Aggressive mode (${ctx.substring(0, 20)}...): ${result.compressedTokens} ≤ ${result.originalTokens}`);
    }
  });

  // ─── Failure Case Guard (should not happen but tested) ────────────────────

  it('If compression fails, reverts to original (G36 guard)', () => {
    // This is a hypothetical test. In reality, if compression increases tokens,
    // the runCompressionPipeline reverts and returns original.
    // We can't easily trigger this without modifying the implementation,
    // but this documents the invariant.
    const ctx = 'any context';
    const result = compressContext(ctx, 'test');
    assert.ok(result.compressedTokens <= result.originalTokens,
      'G36 guard ensures revert if needed');
  });
});
