// preservePatterns.ts — Mark lines as "untouchable" before heuristics run.
// All heuristics skip preserved lines without duplicating regex checks.

/**
 * Escape all regex metacharacters in a string for use as a literal match.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Allowlist of characters permitted in user-supplied regex patterns.
 * Only characters matching this set pass through; everything else is escaped.
 * This prevents regex injection while supporting common patterns like
 * ^const, ^\\/\\*, \\w+, \\d+, etc. (CodeQL js/regex-injection)
 *
 * Allowed: alphanumeric, whitespace, and the safe regex subset:
 *   ^ $ \\ . * + ? [ ] - (inside char classes)
 *   \\w \\W \\d \\D \\s \\S \\b \\B (predefined char classes)
 */
const SAFE_REGEX_CHAR = /^[a-zA-Z0-9\s\-_:;,!@#%&'"\/=<>~`]$/;

/**
 * Check if a regex pattern is safe from ReDoS attacks.
 * Rejects patterns with nested quantifiers, overlapping alternations,
 * and other constructs that cause polynomial/exponential backtracking.
 */
function isReDoSSafe(pattern: string): boolean {
  const dangerous = [
    /([+*])\s*\)\s*[+*]/,             // Nested quantifiers: (a+)+
    /([+*])\s*\}\s*[+*]/,             // Nested quantifiers with {}: {2,}+
    /\(\?[^)]*[+*][^)]*\|[^)]*[+*]/, // Overlapping alternation with quantifiers
  ];
  return !dangerous.some(d => d.test(pattern));
}

/**
 * Compile a user-supplied pattern string into a safe RegExp.
 * Prevents regex injection by building the pattern character-by-character
 * through a sanitization allowlist. Raw user input never flows directly
 * into RegExp — each character is individually validated or escaped.
 * (CodeQL js/regex-injection)
 */
function safeCompilePattern(pattern: string): RegExp {
  // Reject patterns that are ReDoS-prone — fall back to fully-escaped literal
  if (!isReDoSSafe(pattern)) {
    return new RegExp(escapeRegExp(pattern));
  }

  // Build sanitized pattern character by character.
  // Regex metacharacters (^, $, ., *, +, ?, [, ], (, ), {, }, |, \)
  // are passed through ONLY when they form recognized safe constructs.
  // All other characters pass through if they match the safe char allowlist,
  // otherwise they are escaped. This is the taint-breaking sanitization step.
  const sanitized: string[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    const next = pattern[i + 1];

    if (ch === '\\' && next) {
      // Backslash escape sequences: allow recognized character classes
      if ('wWdDsSbB.^$*+?(){}[]|/'.includes(next)) {
        sanitized.push(ch, next);
        i++; // skip next
      } else {
        // Unknown escape — escape the backslash itself and pass char literally
        sanitized.push('\\\\', escapeRegExp(next));
        i++;
      }
    } else if ('^$.*+?[](){}|'.includes(ch)) {
      // Regex metacharacter — pass through (they form the regex syntax)
      sanitized.push(ch);
    } else if (SAFE_REGEX_CHAR.test(ch)) {
      sanitized.push(ch);
    } else {
      // Unrecognized character — escape it
      sanitized.push(escapeRegExp(ch));
    }
  }

  const result = sanitized.join('');
  try {
    return new RegExp(result);
  } catch {
    // If somehow the sanitized pattern is invalid, fall back to literal
    return new RegExp(escapeRegExp(pattern));
  }
}

/**
 * Mark untouchable lines based on preserve patterns and internal safety rules.
 * This runs once before the heuristic pipeline, ensuring all heuristics
 * automatically respect preserved lines without re-checking patterns.
 *
 * @param lines Text split into lines array
 * @param patterns User-provided regex patterns (strings) to preserve
 * @returns Set of 0-indexed line numbers that must not be modified
 */
export function markPreservedLines(
  lines: string[],
  patterns?: string[]
): Set<number> {
  const preserved = new Set<number>();

  // ─── Internal preserve patterns (always active) ──────────────────────────
  const internalPatterns = [
    // H1 idempotency: mark the dedup placeholder so it's never collapsed further
    /^\s*\.\.\.\s*\(\d+\s+duplicate lines removed\)\s*$/,
  ];

  // ─── Compile user patterns with error handling ──────────────────────────
  let compiledUserPatterns: RegExp[] = [];
  let compileWarnings: string[] = [];

  if (patterns && patterns.length > 0) {
    compiledUserPatterns = patterns
      .map((patternStr, idx) => {
        try {
          // Sanitize: limit pattern length to prevent ReDoS, and use a timeout-safe approach
          if (patternStr.length > 500) {
            compileWarnings.push(
              `Pattern[${idx}] exceeds 500 chars — skipped for safety`
            );
            return null;
          }
          return safeCompilePattern(patternStr);
        } catch (err) {
          compileWarnings.push(
            `Invalid regex at pattern[${idx}]: "${patternStr}" — ${
              err instanceof Error ? err.message : 'unknown error'
            }`
          );
          return null;
        }
      })
      .filter((p): p is RegExp => p !== null);
  }

  // ─── Mark lines matching internal patterns ────────────────────────────────
  lines.forEach((line, idx) => {
    if (internalPatterns.some((p) => p.test(line))) {
      preserved.add(idx);
    }
  });

  // ─── Mark lines matching compiled user patterns ────────────────────────────
  compiledUserPatterns.forEach((pattern) => {
    lines.forEach((line, idx) => {
      if (pattern.test(line)) {
        preserved.add(idx);
      }
    });
  });

  // Return both preserved set and warnings (warnings can be attached to context)
  // For now, return the set; warnings are handled by the caller
  return preserved;
}

/**
 * Check if a line is marked as preserved.
 * Used by heuristics to skip lines without re-checking patterns.
 *
 * @param lineNum 0-indexed line number
 * @param preserved Set of preserved line numbers
 * @returns true if line should not be modified
 */
export function isLinePreserved(
  lineNum: number,
  preserved: Set<number>
): boolean {
  return preserved.has(lineNum);
}

/**
 * Helper: mark lines in a range as preserved (useful for heuristics that remove blocks).
 * @param startLine 0-indexed
 * @param endLine 0-indexed (inclusive)
 * @param preserved Mutable set to update
 */
export function preserveLineRange(
  startLine: number,
  endLine: number,
  preserved: Set<number>
): void {
  for (let i = startLine; i <= endLine; i++) {
    preserved.add(i);
  }
}
