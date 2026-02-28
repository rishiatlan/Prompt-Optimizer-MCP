// test/deltas.test.ts — Pre-flight delta calculation tests

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCompressionDelta,
  calculateToolPruningDelta,
  calculatePreFlightDeltas,
  formatDelta,
  formatPreFlightDeltas,
} from '../src/deltas.js';
import type { CompressionPipelineResult } from '../src/types.js';
import type { ToolScore } from '../src/pruner.js';

describe('Deltas: Compression Delta Calculation', () => {
  it('returns delta when compression reduces tokens', () => {
    const result: CompressionPipelineResult = {
      compressed: 'const x = 1;',
      originalTokens: 100,
      compressedTokens: 70,
      heuristics_applied: ['H1'],
      removed_sections: ['Removed 30 lines'],
      warnings: [],
      mode: 'standard',
    };

    const delta = calculateCompressionDelta(result);
    assert.ok(delta, 'Delta returned when compression helps');
    assert.equal(delta.tokens_saved_estimate, 30);
    assert.equal(delta.percentage_reduction, 30);
  });

  it('returns null when compression fails to reduce tokens', () => {
    const result: CompressionPipelineResult = {
      compressed: 'const x = 1;',
      originalTokens: 100,
      compressedTokens: 100,
      heuristics_applied: [],
      removed_sections: [],
      warnings: [],
      mode: 'standard',
    };

    const delta = calculateCompressionDelta(result);
    assert.ok(!delta, 'No delta when compression fails');
  });

  it('returns null when compression increases tokens', () => {
    const result: CompressionPipelineResult = {
      compressed: 'const x = 1;',
      originalTokens: 100,
      compressedTokens: 120,
      heuristics_applied: [],
      removed_sections: [],
      warnings: [],
      mode: 'standard',
    };

    const delta = calculateCompressionDelta(result);
    assert.ok(!delta, 'No delta when compression fails');
  });

  it('calculates percentage correctly', () => {
    const result: CompressionPipelineResult = {
      compressed: '',
      originalTokens: 200,
      compressedTokens: 150,
      heuristics_applied: [],
      removed_sections: [],
      warnings: [],
      mode: 'standard',
    };

    const delta = calculateCompressionDelta(result)!;
    assert.equal(delta.percentage_reduction, 25);
  });

  it('handles very small savings (rounds to 1 decimal)', () => {
    const result: CompressionPipelineResult = {
      compressed: '',
      originalTokens: 1000,
      compressedTokens: 997,
      heuristics_applied: [],
      removed_sections: [],
      warnings: [],
      mode: 'standard',
    };

    const delta = calculateCompressionDelta(result)!;
    assert.equal(delta.tokens_saved_estimate, 3);
    assert.equal(delta.percentage_reduction, 0.3);
  });
});

describe('Deltas: Tool Pruning Delta Calculation', () => {
  const toolScores: ToolScore[] = [
    { name: 'read', relevance_score: 80, signals: [], tokens_saved_estimate: 50 },
    { name: 'bash', relevance_score: 70, signals: [], tokens_saved_estimate: 60 },
    { name: 'write', relevance_score: 60, signals: [], tokens_saved_estimate: 40 },
  ];

  it('returns delta when tools are pruned', () => {
    const delta = calculateToolPruningDelta(toolScores, ['write']);
    assert.ok(delta, 'Delta returned when tools pruned');
    assert.equal(delta.tokens_saved_estimate, 40);
  });

  it('returns null when no tools are pruned', () => {
    const delta = calculateToolPruningDelta(toolScores, []);
    assert.ok(!delta, 'No delta when no tools pruned');
  });

  it('sums tokens for multiple pruned tools', () => {
    const delta = calculateToolPruningDelta(toolScores, ['bash', 'write'])!;
    assert.equal(delta.tokens_saved_estimate, 100); // 60 + 40
  });

  it('calculates percentage relative to all tools', () => {
    const delta = calculateToolPruningDelta(toolScores, ['write'])!;
    const totalTokens = 50 + 60 + 40; // 150
    const expectedPercent = (40 / totalTokens) * 100;
    assert.equal(delta.percentage_reduction, Math.round(expectedPercent * 10) / 10);
  });

  it('ignores pruned tools not in scores', () => {
    // Tool 'search' doesn't exist in toolScores
    const delta = calculateToolPruningDelta(toolScores, ['write', 'search'])!;
    assert.equal(delta.tokens_saved_estimate, 40); // Only 'write' counted
  });
});

describe('Deltas: Combined Pre-Flight Deltas', () => {
  it('includes compression delta when compression helps', () => {
    const compressionResult: CompressionPipelineResult = {
      compressed: 'short',
      originalTokens: 100,
      compressedTokens: 70,
      heuristics_applied: [],
      removed_sections: [],
      warnings: [],
      mode: 'standard',
    };

    const deltas = calculatePreFlightDeltas(compressionResult, null, null);

    assert.equal(deltas.original_tokens, 100);
    assert.equal(deltas.estimated_total_savings, 30);
    assert.equal(deltas.deltas.length, 1);
    assert.equal(deltas.deltas[0].optimization, 'compression');
  });

  it('includes tool pruning delta when tools are pruned', () => {
    const toolScores: ToolScore[] = [
      { name: 'read', relevance_score: 80, signals: [], tokens_saved_estimate: 50 },
      { name: 'write', relevance_score: 40, signals: [], tokens_saved_estimate: 30 },
    ];

    const deltas = calculatePreFlightDeltas(null, toolScores, ['write']);

    assert.equal(deltas.estimated_total_savings, 30);
    assert.equal(deltas.deltas.length, 1);
    assert.equal(deltas.deltas[0].optimization, 'tool_pruning');
  });

  it('includes both deltas when both optimizations apply', () => {
    const compressionResult: CompressionPipelineResult = {
      compressed: 'short',
      originalTokens: 100,
      compressedTokens: 70,
      heuristics_applied: [],
      removed_sections: [],
      warnings: [],
      mode: 'standard',
    };

    const toolScores: ToolScore[] = [
      { name: 'read', relevance_score: 80, signals: [], tokens_saved_estimate: 50 },
      { name: 'write', relevance_score: 40, signals: [], tokens_saved_estimate: 30 },
    ];

    const deltas = calculatePreFlightDeltas(compressionResult, toolScores, ['write']);

    assert.equal(deltas.deltas.length, 2);
    assert.equal(deltas.estimated_total_savings, 60); // 30 (compression) + 30 (pruning)
  });

  it('returns empty deltas when no optimizations help', () => {
    const compressionResult: CompressionPipelineResult = {
      compressed: 'x',
      originalTokens: 100,
      compressedTokens: 100,
      heuristics_applied: [],
      removed_sections: [],
      warnings: [],
      mode: 'standard',
    };

    const deltas = calculatePreFlightDeltas(compressionResult, null, null);

    assert.equal(deltas.deltas.length, 0);
    assert.equal(deltas.estimated_total_savings, 0);
    assert.ok(deltas.summary.includes('No optimizations'));
  });

  it('generates appropriate summary', () => {
    const compressionResult: CompressionPipelineResult = {
      compressed: 'short',
      originalTokens: 100,
      compressedTokens: 70,
      heuristics_applied: [],
      removed_sections: [],
      warnings: [],
      mode: 'standard',
    };

    const deltas = calculatePreFlightDeltas(compressionResult, null, null);

    assert.ok(deltas.summary.includes('compression'));
    assert.ok(deltas.summary.includes('30'));
  });
});

describe('Deltas: Formatting', () => {
  it('formats single delta readably', () => {
    const delta = {
      optimization: 'compression' as const,
      tokens_saved_estimate: 30,
      percentage_reduction: 15.5,
    };

    const formatted = formatDelta(delta);
    assert.ok(formatted.includes('Compression'));
    assert.ok(formatted.includes('30'));
    assert.ok(formatted.includes('15.5'));
  });

  it('formats pre-flight deltas with summary', () => {
    const compressionResult: CompressionPipelineResult = {
      compressed: 'short',
      originalTokens: 100,
      compressedTokens: 70,
      heuristics_applied: [],
      removed_sections: [],
      warnings: [],
      mode: 'standard',
    };

    const deltas = calculatePreFlightDeltas(compressionResult, null, null);
    const formatted = formatPreFlightDeltas(deltas);

    assert.ok(formatted.includes('Compression'));
    assert.ok(formatted.includes('30'));
    assert.ok(formatted.includes('Total estimated savings'));
  });

  it('formats empty deltas', () => {
    const compressionResult: CompressionPipelineResult = {
      compressed: 'x',
      originalTokens: 100,
      compressedTokens: 100,
      heuristics_applied: [],
      removed_sections: [],
      warnings: [],
      mode: 'standard',
    };

    const deltas = calculatePreFlightDeltas(compressionResult, null, null);
    const formatted = formatPreFlightDeltas(deltas);

    assert.ok(formatted.includes('No optimizations'));
  });
});

describe('Deltas: Edge Cases', () => {
  it('handles zero original tokens gracefully', () => {
    const result: CompressionPipelineResult = {
      compressed: '',
      originalTokens: 0,
      compressedTokens: 0,
      heuristics_applied: [],
      removed_sections: [],
      warnings: [],
      mode: 'standard',
    };

    const deltas = calculatePreFlightDeltas(result, null, null);
    assert.equal(deltas.original_tokens, 0);
    assert.equal(deltas.estimated_total_savings, 0);
  });

  it('handles very large token counts', () => {
    const result: CompressionPipelineResult = {
      compressed: 'x',
      originalTokens: 1_000_000,
      compressedTokens: 999_500,
      heuristics_applied: [],
      removed_sections: [],
      warnings: [],
      mode: 'standard',
    };

    const delta = calculateCompressionDelta(result)!;
    assert.equal(delta.tokens_saved_estimate, 500);
    // 500 / 1,000,000 * 100 = 0.05%, which rounds to 0.1% with 1 decimal place
    assert.equal(delta.percentage_reduction, 0.1);
  });

  it('handles fractional percentages (rounds to 1 decimal)', () => {
    const result: CompressionPipelineResult = {
      compressed: 'x',
      originalTokens: 333,
      compressedTokens: 322,
      heuristics_applied: [],
      removed_sections: [],
      warnings: [],
      mode: 'standard',
    };

    const delta = calculateCompressionDelta(result)!;
    // 11/333 * 100 = 3.303...%
    assert.equal(delta.percentage_reduction, 3.3);
  });
});
