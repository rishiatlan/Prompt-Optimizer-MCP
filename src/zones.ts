// zones.ts — Zone scanner for identifying safe/unsafe regions in context/code.
// Heuristics respect zones: never remove content within fenced code, markdown tables, etc.

/**
 * Zone type identifies structured regions in text that should not be altered.
 * Heuristics must skip zones or be explicitly marked as zone-aware.
 */
export interface Zone {
  startLine: number;  // 0-indexed
  endLine: number;    // inclusive
  type: 'fenced_code' | 'markdown_table' | 'markdown_list' | 'json_block' | 'yaml_block';
}

/**
 * Scan text for structured zones (fenced code blocks, tables, lists, etc.).
 * Used to protect content from over-aggressive heuristics.
 *
 * Conservative matching: prefers under-matching to over-matching.
 * For example, a single `|` line is not a table; need >=2 consecutive lines.
 *
 * @param text Input text (or lines to scan)
 * @returns Array of Zone objects (sorted by startLine)
 */
export function scanZones(text: string): Zone[] {
  const lines = text.split('\n');
  return scanZonesByLines(lines);
}

/**
 * Internal: scan zones from pre-split lines array.
 * @param lines Array of strings (one line per element)
 * @returns Zone array
 */
export function scanZonesByLines(lines: string[]): Zone[] {
  const zones: Zone[] = [];
  const seen = new Set<number>();

  // ─── Fenced code blocks ──────────────────────────────────────────────────
  let i = 0;
  while (i < lines.length) {
    if (/^```/.test(lines[i]) && !seen.has(i)) {
      const startLine = i;
      const fence = lines[i].slice(0, 3); // captures ``` or other fence styles
      i++;
      // Find closing fence
      while (i < lines.length && !lines[i].startsWith(fence)) {
        i++;
      }
      if (i < lines.length) {
        zones.push({
          startLine,
          endLine: i,
          type: 'fenced_code',
        });
        // Mark all lines in zone as seen
        for (let j = startLine; j <= i; j++) seen.add(j);
      }
      i++;
    } else {
      i++;
    }
  }

  // ─── Markdown tables (>= 2 consecutive | lines) ───────────────────────────
  i = 0;
  while (i < lines.length) {
    if (/^\s*\|/.test(lines[i]) && !seen.has(i)) {
      const startLine = i;
      i++;
      // Count consecutive table lines
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        i++;
      }
      const tableEndLine = i - 1;
      // Only mark as table if >= 2 lines (conservative)
      if (tableEndLine - startLine >= 1 && !seen.has(startLine)) {
        zones.push({
          startLine,
          endLine: tableEndLine,
          type: 'markdown_table',
        });
        for (let j = startLine; j <= tableEndLine; j++) seen.add(j);
      }
    } else {
      i++;
    }
  }

  // ─── Markdown lists (>= 3 consecutive list lines) ──────────────────────────
  i = 0;
  while (i < lines.length) {
    if (/^\s*[-*+]\s/.test(lines[i]) && !seen.has(i)) {
      const startLine = i;
      i++;
      while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) {
        i++;
      }
      const listEndLine = i - 1;
      // Only mark as list if >= 3 lines (conservative)
      if (listEndLine - startLine >= 2 && !seen.has(startLine)) {
        zones.push({
          startLine,
          endLine: listEndLine,
          type: 'markdown_list',
        });
        for (let j = startLine; j <= listEndLine; j++) seen.add(j);
      }
    } else {
      i++;
    }
  }

  // ─── JSON blocks (fenced or whole-text JSON) ──────────────────────────────
  // First: inside fenced ```json blocks (already handled by fenced code)
  // Second: if entire text looks like JSON
  const wholeText = lines.join('\n').trim();
  if (wholeText.length < 200000 && (wholeText.startsWith('{') || wholeText.startsWith('['))) {
    try {
      JSON.parse(wholeText);
      // Valid JSON: mark entire text as JSON zone (unless already in zone)
      if (zones.length === 0) {
        zones.push({
          startLine: 0,
          endLine: lines.length - 1,
          type: 'json_block',
        });
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  // ─── YAML blocks (fenced or frontmatter) ──────────────────────────────────
  // Frontmatter: starts with --- and closes within first 80 lines
  if (lines[0]?.startsWith('---')) {
    let endLine = -1;
    for (let j = 1; j < Math.min(80, lines.length); j++) {
      if (lines[j]?.startsWith('---')) {
        endLine = j;
        break;
      }
    }
    if (endLine > 0) {
      // Check if it looks like YAML (has : mappings)
      const hasMapping = lines
        .slice(1, endLine)
        .some((l) => /^[a-zA-Z_][\w-]*\s*:\s*/.test(l));
      if (hasMapping && !seen.has(0)) {
        zones.push({
          startLine: 0,
          endLine,
          type: 'yaml_block',
        });
        for (let j = 0; j <= endLine; j++) seen.add(j);
      }
    }
  }

  // Sort by startLine
  zones.sort((a, b) => a.startLine - b.startLine);
  return zones;
}

/**
 * Check if a line number is inside any zone.
 * @param lineNum 0-indexed line number
 * @param zones Array of zones
 * @returns true if line is in a zone
 */
export function isLineInZone(lineNum: number, zones: Zone[]): boolean {
  return zones.some((z) => lineNum >= z.startLine && lineNum <= z.endLine);
}

/**
 * Re-export for convenience in heuristics.
 * This is a wrapper that accepts a line number and set.
 */
export function isLinePreserved(lineNum: number, preserved: Set<number>): boolean {
  return preserved.has(lineNum);
}

/**
 * Get all zones covering a range of lines.
 * @param startLine 0-indexed
 * @param endLine 0-indexed (inclusive)
 * @param zones Zone array
 * @returns Subset of zones that overlap with range
 */
export function getZonesInRange(startLine: number, endLine: number, zones: Zone[]): Zone[] {
  return zones.filter((z) => !(z.endLine < startLine || z.startLine > endLine));
}
