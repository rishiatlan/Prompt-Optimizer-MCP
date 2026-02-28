// test/constants.test.ts — Tests for frozen constants and utilities

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stableStringify, PRUNE_THRESHOLD, LICENSE_SCAN_LINES } from '../src/constants.js';

describe('stableStringify', () => {
  it('produces deterministic output for objects', () => {
    const obj = { z: 1, a: 2, m: 3 };
    const str1 = stableStringify(obj);
    const str2 = stableStringify(obj);
    assert.equal(str1, str2);
  });

  it('sorts keys alphabetically', () => {
    const obj = { z: 'z', a: 'a', m: 'm' };
    const str = stableStringify(obj);
    // Should be {"a":"a","m":"m","z":"z"}
    assert.ok(str.indexOf('"a"') < str.indexOf('"m"'));
    assert.ok(str.indexOf('"m"') < str.indexOf('"z"'));
  });

  it('removes all whitespace', () => {
    const obj = { key: 'value', nested: { inner: 1 } };
    const str = stableStringify(obj);
    assert.ok(!str.includes(' '));
    assert.ok(!str.includes('\n'));
    assert.ok(!str.includes('\t'));
  });

  it('handles arrays', () => {
    const arr = [1, 2, 3];
    const str = stableStringify(arr);
    assert.equal(str, '[1,2,3]');
  });

  it('handles nested structures', () => {
    const obj = { tools: [{ name: 'a' }, { name: 'b' }] };
    const str1 = stableStringify(obj);
    const str2 = stableStringify(obj);
    assert.equal(str1, str2);
  });

  it('handles null and undefined', () => {
    assert.equal(stableStringify(null), '');
    assert.equal(stableStringify(undefined), '');
  });

  it('handles primitives', () => {
    assert.equal(stableStringify(42), '42');
    assert.equal(stableStringify('hello'), 'hello');
    assert.equal(stableStringify(true), 'true');
  });

  it('is consistent with different key orderings', () => {
    const obj1 = { a: 1, b: 2, c: 3 };
    const obj2 = { c: 3, a: 1, b: 2 };
    const str1 = stableStringify(obj1);
    const str2 = stableStringify(obj2);
    assert.equal(str1, str2);
  });
});

describe('frozen constants', () => {
  it('LICENSE_SCAN_LINES is 40', () => {
    assert.equal(LICENSE_SCAN_LINES, 40);
  });

  it('PRUNE_THRESHOLD is 15', () => {
    assert.equal(PRUNE_THRESHOLD, 15);
  });
});
