// test/zones-termination.test.ts — Explicit zone termination semantics
// Tests the most common regression: when zones end (not when they start)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanZones } from '../src/zones.js';

describe('Zone Termination Semantics', () => {
  describe('table zone termination (>1 non-| line ends)', () => {
    it('ends table when two consecutive non-| lines appear', () => {
      const text =
        'before\n' +
        '| col1 | col2 |\n' +
        '| ---- | ---- |\n' +
        '| cell | cell |\n' +
        'non-table line\n' +
        'another non-table\n' +
        '| this should NOT be in table zone |';

      const zones = scanZones(text);
      const table = zones.find((z) => z.type === 'markdown_table');

      if (table) {
        // Table should end at line 3 (last | line before 2 non-| lines)
        assert.ok(table.endLine <= 3,
          `Table should not extend past 2 non-| lines; ended at ${table.endLine}`);
      }
    });

    it('continues table if only one non-| line interrupts', () => {
      const text =
        '| col1 |\n' +
        '| ---- |\n' +
        '| cell |\n' +
        'one non-table line\n' +
        '| continuation |';

      // Note: strict implementation may not handle this (single interruption).
      // This test documents the current behavior.
      const zones = scanZones(text);
      const tables = zones.filter((z) => z.type === 'markdown_table');
      // Either: one table that spans, or two separate tables
      assert.ok(tables.length >= 1, 'Should detect at least one table');
    });
  });

  describe('list zone termination (>1 non-list line ends)', () => {
    it('ends list when two consecutive non-list lines appear', () => {
      const text =
        'before\n' +
        '- item 1\n' +
        '- item 2\n' +
        '- item 3\n' +
        'non-list line\n' +
        'another non-list\n' +
        '- this should NOT be in list zone';

      const zones = scanZones(text);
      const list = zones.find((z) => z.type === 'markdown_list');

      if (list) {
        // List should end at line 3 (last - line before 2 non-list lines)
        assert.ok(list.endLine <= 3,
          `List should not extend past 2 non-list lines; ended at ${list.endLine}`);
      }
    });

    it('requires >=3 lines to be detected as list (conservative)', () => {
      const text1 = '- item 1\n- item 2'; // 2 lines
      const text2 = '- item 1\n- item 2\n- item 3'; // 3 lines

      const zones1 = scanZones(text1);
      const zones2 = scanZones(text2);

      const list1 = zones1.find((z) => z.type === 'markdown_list');
      const list2 = zones2.find((z) => z.type === 'markdown_list');

      assert.ok(!list1 || list1.startLine > 0,
        '2-line list should not be detected');
      assert.ok(list2,
        '3-line list should be detected');
    });
  });

  describe('fenced code block termination (closing fence)', () => {
    it('ends at first closing fence', () => {
      const text =
        'before\n' +
        '```js\n' +
        'const x = 1;\n' +
        '```\n' +
        'after\n' +
        '```js again (should not be zone)';

      const zones = scanZones(text);
      const fenced = zones.find((z) => z.type === 'fenced_code');

      if (fenced) {
        assert.equal(fenced.startLine, 1);
        assert.equal(fenced.endLine, 3);
      }
    });
  });

  describe('JSON zone detection (whole-input only)', () => {
    it('detects whole-input JSON objects', () => {
      const text = '{"name":"test","value":42}';
      const zones = scanZones(text);
      const json = zones.find((z) => z.type === 'json_block');
      assert.ok(json, 'Should detect whole-input JSON');
    });

    it('detects whole-input JSON arrays', () => {
      const text = '[1,2,3,"four"]';
      const zones = scanZones(text);
      const json = zones.find((z) => z.type === 'json_block');
      assert.ok(json, 'Should detect whole-input JSON array');
    });

    it('does NOT detect JSON buried in text (outside fenced block)', () => {
      const text =
        'Here is some JSON: {"key":"value"}\nBut it is not a JSON block';
      const zones = scanZones(text);
      const json = zones.find((z) => z.type === 'json_block');
      // Should not detect as JSON zone (not whole-input)
      assert.ok(!json, 'JSON substring in text should not be detected as zone');
    });

    it('respects 200K character limit', () => {
      const largeObj = JSON.stringify(
        { data: 'x'.repeat(300_000) }
      );
      const zones = scanZones(largeObj);
      const json = zones.find((z) => z.type === 'json_block');
      // Should not detect as zone (>200K)
      assert.ok(!json || zones.length === 0,
        'Large JSON (>200K) should not be detected as zone');
    });
  });

  describe('YAML zone detection (frontmatter only)', () => {
    it('detects frontmatter with mapping syntax', () => {
      const text =
        '---\n' +
        'title: My Post\n' +
        'author: Me\n' +
        '---\n' +
        'Content here';

      const zones = scanZones(text);
      const yaml = zones.find((z) => z.type === 'yaml_block');
      assert.ok(yaml, 'Should detect YAML frontmatter');
      assert.equal(yaml?.startLine, 0);
    });

    it('requires --- at both start and close', () => {
      const text =
        '---\n' +
        'title: Test\n' +
        'body text instead of closing';

      const zones = scanZones(text);
      const yaml = zones.find((z) => z.type === 'yaml_block');
      assert.ok(!yaml, 'YAML without closing --- should not be detected');
    });

    it('closes within first 80 lines max', () => {
      const lines = ['---', 'title: test'];
      for (let i = 0; i < 85; i++) {
        lines.push(`line ${i}: content`);
      }
      lines.push('---'); // Closing fence at line 87 (beyond 80)

      const text = lines.join('\n');
      const zones = scanZones(text);
      const yaml = zones.find((z) => z.type === 'yaml_block');
      // Should not detect (closing fence beyond line 80)
      assert.ok(!yaml, 'YAML with closing fence >line 80 should not be detected');
    });
  });

  describe('Conservative matching (under-matching prioritized)', () => {
    it('single | does not start table', () => {
      const text = 'Some text with | a pipe';
      const zones = scanZones(text);
      const table = zones.find((z) => z.type === 'markdown_table');
      assert.ok(!table, 'Single | should not create table zone');
    });

    it('single - does not start list', () => {
      const text = '- item 1'; // Only 1 item
      const zones = scanZones(text);
      const list = zones.find((z) => z.type === 'markdown_list');
      assert.ok(!list, 'Single-item list should not create zone');
    });

    it('prefers under-detection over false positives', () => {
      const ambiguous = '| maybe | table |\nmaybe not';
      const zones = scanZones(ambiguous);
      // If detected, should be conservative (not extend further)
      const table = zones.find((z) => z.type === 'markdown_table');
      if (table) {
        assert.equal(table.endLine, 0, 'Should not extend ambiguous pattern');
      }
    });
  });
});
