// test/helpers/assertNoPromptContent.ts — Enforces "no prompt content" privacy contract.
// Recursively walks object keys + string values.
// Used in audit log, list_sessions, purge, delete response tests.

import assert from 'node:assert/strict';

const FORBIDDEN_KEYS = new Set(['raw_prompt', 'compiled_prompt', 'prompt_preview']);
const MAX_STRING_LENGTH = 500; // catches accidental prompt leaks

/**
 * Assert that an object contains no prompt content.
 * Throws AssertionError if any forbidden key or long string is found.
 */
export function assertNoPromptContent(obj: unknown, path = ''): void {
  if (obj === null || obj === undefined) return;

  if (typeof obj === 'string') {
    assert.ok(
      obj.length <= MAX_STRING_LENGTH,
      `String at ${path || 'root'} exceeds ${MAX_STRING_LENGTH} chars (${obj.length}) — possible prompt leak`,
    );
    return;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      assertNoPromptContent(obj[i], `${path}[${i}]`);
    }
    return;
  }

  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      assert.ok(
        !FORBIDDEN_KEYS.has(key),
        `Forbidden key "${key}" found at ${path ? `${path}.${key}` : key} — prompt content must not appear`,
      );
      assertNoPromptContent(value, path ? `${path}.${key}` : key);
    }
  }
}
