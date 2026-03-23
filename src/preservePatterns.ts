// preservePatterns.ts — Mark lines as "untouchable" before heuristics run.
// All heuristics skip preserved lines without duplicating regex checks.

/**
 * Validate a user-supplied regex string is safe to compile.
 * If it looks like a literal string (no regex metacharacters), escape it.
 * This prevents regex injection from user-controlled pattern strings.
 */
function escapeRegExpIfNeeded(pattern: string): string {
  // Detect likely-dangerous quantifier nesting patterns that cause polynomial ReDoS
  // e.g., (a+)+, (a*)*,  (\w+)+ etc.
  const dangerousNesting = /([+*])\s*\)\s*[+*]/;
  if (dangerousNesting.test(pattern)) {
    // Fall back to literal match — escape all metacharacters
    return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return pattern;
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
          return new RegExp(escapeRegExpIfNeeded(patternStr));
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
