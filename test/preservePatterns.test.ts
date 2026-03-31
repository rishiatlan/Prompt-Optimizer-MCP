// test/preservePatterns.test.ts — Tests for preserve patterns marking

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  markPreservedLines,
  isLinePreserved,
  preserveLineRange,
} from '../src/preservePatterns.js';

describe('markPreservedLines', () => {
  it('marks internal H1 placeholder as preserved (idempotency)', () => {
    const lines = [
      'line 0',
      '... (5 duplicate lines removed)',
      'line 2',
      '... (10 duplicate lines removed)',
    ];
    const preserved = markPreservedLines(lines);
    assert.ok(preserved.has(1), 'H1 placeholder should be preserved');
    assert.ok(preserved.has(3), 'H1 placeholder should be preserved');
    assert.ok(!preserved.has(0), 'Regular line should not be preserved');
  });

  it('handles no user patterns gracefully', () => {
    const lines = ['line 1', 'line 2', 'line 3'];
    const preserved = markPreservedLines(lines);
    assert.equal(preserved.size, 0, 'Should have no preserved lines');
  });

  it('marks lines matching user patterns', () => {
    const lines = [
      'const x = 1;',
      'const y = 2;',
      'let z = 3;',
      'const w = 4;',
    ];
    const patterns = ['^const'];
    const preserved = markPreservedLines(lines, patterns);
    assert.ok(preserved.has(0));
    assert.ok(preserved.has(1));
    assert.ok(!preserved.has(2));
    assert.ok(preserved.has(3));
  });

  it('compiles multiple patterns correctly', () => {
    const lines = ['// comment', '/* block */', 'code'];
    const patterns = ['^//', '^\\/\\*'];
    const preserved = markPreservedLines(lines, patterns);
    assert.ok(preserved.has(0));
    assert.ok(preserved.has(1));
    assert.ok(!preserved.has(2));
  });

  it('handles invalid regex patterns gracefully (does not crash)', () => {
    const lines = ['line 1', 'line 2'];
    const patterns = ['valid.*', '[invalid(regex'];
    // Should not throw; invalid patterns are skipped
    const preserved = markPreservedLines(lines, patterns);
    assert.ok(preserved instanceof Set);
  });

  it('marks multiple lines when pattern matches multiple lines', () => {
    const lines = [
      'preserve_me',
      'normal line',
      'preserve_me',
      'preserve_me',
    ];
    const patterns = ['preserve_me'];
    const preserved = markPreservedLines(lines, patterns);
    assert.equal(preserved.size, 3);
    assert.ok(preserved.has(0));
    assert.ok(preserved.has(2));
    assert.ok(preserved.has(3));
  });
});

// ─── Security regression tests (CodeQL js/regex-injection) ──────────────────
describe('safeCompilePattern — regex injection prevention', () => {
  it('nested quantifier pattern is escaped to literal (ReDoS prevention)', () => {
    const lines = ['(a+)+', 'normal'];
    const preserved = markPreservedLines(lines, ['(a+)+']);
    // Pattern should be treated as literal, matching the exact string "(a+)+"
    assert.ok(preserved.has(0));
    assert.ok(!preserved.has(1));
  });

  it('user pattern with metacharacters works safely', () => {
    const lines = ['file.txt', 'filetxt', 'other'];
    const preserved = markPreservedLines(lines, ['file\\.txt']);
    assert.ok(preserved.has(0));
    assert.ok(!preserved.has(1)); // should NOT match without the dot
  });

  it('user pattern with anchors works', () => {
    const lines = ['const x = 1;', 'let const y = 2;', 'const z = 3;'];
    const preserved = markPreservedLines(lines, ['^const']);
    assert.ok(preserved.has(0));
    assert.ok(!preserved.has(1)); // "const" not at start
    assert.ok(preserved.has(2));
  });

  it('extremely long pattern is rejected safely', () => {
    const lines = ['a'.repeat(600), 'short'];
    const longPattern = 'a'.repeat(600);
    // Should not throw; long patterns are skipped with a warning
    const preserved = markPreservedLines(lines, [longPattern]);
    assert.ok(preserved instanceof Set);
  });

  it('pattern with backslash character classes works', () => {
    const lines = ['abc123', '------', 'hello'];
    const preserved = markPreservedLines(lines, ['\\w+\\d+']);
    assert.ok(preserved.has(0));    // "abc123" matches \\w+\\d+
    assert.ok(!preserved.has(1));   // "------" has no word/digit chars at start
  });
});

describe('isLinePreserved', () => {
  it('returns true for preserved line', () => {
    const preserved = new Set([1, 3, 5]);
    assert.ok(isLinePreserved(1, preserved));
    assert.ok(isLinePreserved(3, preserved));
  });

  it('returns false for non-preserved line', () => {
    const preserved = new Set([1, 3]);
    assert.ok(!isLinePreserved(0, preserved));
    assert.ok(!isLinePreserved(2, preserved));
  });
});

describe('preserveLineRange', () => {
  it('marks range of lines as preserved', () => {
    const preserved = new Set<number>();
    preserveLineRange(2, 5, preserved);
    assert.ok(preserved.has(2));
    assert.ok(preserved.has(3));
    assert.ok(preserved.has(4));
    assert.ok(preserved.has(5));
    assert.ok(!preserved.has(1));
    assert.ok(!preserved.has(6));
  });

  it('handles single-line range', () => {
    const preserved = new Set<number>();
    preserveLineRange(3, 3, preserved);
    assert.ok(preserved.has(3));
    assert.equal(preserved.size, 1);
  });

  it('preserves existing entries', () => {
    const preserved = new Set([0, 10]);
    preserveLineRange(5, 7, preserved);
    assert.ok(preserved.has(0));
    assert.ok(preserved.has(5));
    assert.ok(preserved.has(6));
    assert.ok(preserved.has(7));
    assert.ok(preserved.has(10));
    assert.equal(preserved.size, 5); // 0, 5, 6, 7, 10
  });
});
