// src/lint-cli.ts — Standalone CLI linter. No MCP server, no storage, no sessions.
// Reuses the pure API functions directly: analyzePrompt, detectTaskType, scorePrompt, runRules.

import { readFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzePrompt, detectTaskType, scorePrompt, runRules } from './api.js';
import { sortIssues } from './sort.js';
import { customRules } from './customRules.js';

// ─── Version (read from package.json at runtime, not hardcoded) ──────────────
// After compilation, this file lives at dist/src/lint-cli.js. package.json is at repo root.

const __lint_dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__lint_dirname, '..', '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const VERSION: string = pkg.version;

// ─── Thresholds (match STRICTNESS_THRESHOLDS from tools.ts) ──────────────────

const THRESHOLDS = { relaxed: 40, standard: 60, strict: 75 } as const;

// ─── Types ───────────────────────────────────────────────────────────────────

interface LintResult {
  source: string;
  score: number;
  pass: boolean;
  issues: Array<{ rule: string; severity: string; message: string }>;
}

interface JsonOutput {
  version: string;
  threshold: number;
  results: LintResult[];
  summary: { total: number; passed: number; failed: number };
}

interface JsonError {
  error: { code: number; message: string };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fatal(message: string, jsonMode: boolean): never {
  if (jsonMode) {
    const err: JsonError = { error: { code: 2, message } };
    process.stdout.write(JSON.stringify(err, null, 2) + '\n');
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }
  process.exit(2);
}

function lintPrompt(prompt: string, source: string, threshold: number): LintResult {
  const taskType = detectTaskType(prompt);
  const intentSpec = analyzePrompt(prompt);
  const score = scorePrompt(intentSpec);
  const pass = score.total >= threshold;

  const ruleResults = runRules(prompt, undefined, taskType);
  const sorted = sortIssues(ruleResults).filter(r => r.triggered);
  const issues = sorted.slice(0, 5).map(r => ({
    rule: r.rule_name,
    severity: r.severity,
    message: r.message,
  }));

  return { source, score: score.total, pass, issues };
}

/** Recursively collect .txt and .md files from a directory. */
function collectFilesFromDir(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      results.push(...collectFilesFromDir(full));
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (ext === '.txt' || ext === '.md') {
        results.push(full);
      }
    }
  }
  return results;
}

/** Resolve --file args to a sorted list of absolute paths. Uses fast-glob for globs. */
async function resolveFiles(fileArgs: string[]): Promise<string[]> {
  const allFiles: string[] = [];

  for (const arg of fileArgs) {
    // Check if it's an existing file or directory first
    try {
      const stat = statSync(arg);
      if (stat.isDirectory()) {
        allFiles.push(...collectFilesFromDir(resolve(arg)));
        continue;
      }
      if (stat.isFile()) {
        allFiles.push(resolve(arg));
        continue;
      }
    } catch {
      // Not a literal file/dir — treat as glob pattern
    }

    // Use fast-glob for glob patterns
    const fg = await import('fast-glob');
    const matches = await fg.default(arg, {
      onlyFiles: true,
      unique: true,
      ignore: ['**/node_modules/**'],
    });
    allFiles.push(...matches.map(m => resolve(m)));
  }

  // Deterministic ordering: sort alphabetically
  return [...new Set(allFiles)].sort((a, b) => a.localeCompare(b));
}

// ─── Arg Parsing ─────────────────────────────────────────────────────────────

interface ParsedArgs {
  help: boolean;
  version: boolean;
  validateCustomRules: boolean;
  json: boolean;
  strict: boolean;
  relaxed: boolean;
  threshold: number | null;
  fileArgs: string[];
  promptArg: string | null;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    help: false,
    version: false,
    validateCustomRules: false,
    json: false,
    strict: false,
    relaxed: false,
    threshold: null,
    fileArgs: [],
    promptArg: null,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--version' || arg === '-v') {
      result.version = true;
    } else if (arg === '--json') {
      result.json = true;
    } else if (arg === '--strict') {
      result.strict = true;
    } else if (arg === '--relaxed') {
      result.relaxed = true;
    } else if (arg === '--threshold') {
      i++;
      if (i >= argv.length) {
        fatal('--threshold requires a value', result.json);
      }
      const raw = argv[i];
      const val = Number(raw);
      if (!Number.isInteger(val) || val < 0 || val > 100) {
        fatal(`--threshold must be an integer 0-100, got: ${raw}`, result.json);
      }
      result.threshold = val;
    } else if (arg === '--file' || arg === '-f') {
      i++;
      if (i >= argv.length) {
        fatal('--file requires a value', result.json);
      }
      result.fileArgs.push(argv[i]);
    } else if (arg === '--validate-custom-rules') {
      result.validateCustomRules = true;
    } else if (arg.startsWith('-')) {
      fatal(`Unknown flag: ${arg}`, result.json);
    } else {
      // Positional argument = prompt text
      if (result.promptArg !== null) {
        fatal('Only one prompt argument allowed. Use --file for multiple prompts.', result.json);
      }
      result.promptArg = arg;
    }
    i++;
  }

  return result;
}

// ─── Help Text ───────────────────────────────────────────────────────────────

const HELP = `prompt-lint v${VERSION}

Usage:
  prompt-lint "your prompt text"              Lint a prompt directly
  prompt-lint --file prompts/api.txt          Lint a file
  prompt-lint --file "prompts/**/*.txt"       Lint files matching a glob
  echo "prompt" | prompt-lint                 Lint from stdin

Options:
  --threshold <n>          Minimum quality score 0-100 (default: 60)
  --strict                 Set threshold to 75
  --relaxed                Set threshold to 40
  --json                   Output JSON (for CI parsing)
  --file, -f <path>        File or glob to lint (repeatable)
  --validate-custom-rules  Validate custom-rules.json and exit
  --help, -h               Show this help
  --version, -v            Show version

Exit codes:
  0  All prompts pass threshold
  1  One or more prompts fail threshold
  2  Invalid arguments, no input, or no files matched
`;

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // --help
  if (args.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  // --version
  if (args.version) {
    process.stdout.write(`prompt-lint v${VERSION}\n`);
    process.exit(0);
  }

  // --validate-custom-rules
  if (args.validateCustomRules) {
    const rules = await customRules.loadRules();
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const rule of rules) {
      const validation = customRules.validateRule(rule);
      if (!validation.valid) {
        errors.push(...validation.errors.map(e => `Rule "${rule.id}": ${e}`));
      }
    }

    // Try to compile each pattern and negative_pattern
    for (const rule of rules) {
      try {
        new RegExp(rule.pattern);
      } catch (err) {
        warnings.push(`Rule "${rule.id}": pattern failed to compile, will be skipped at runtime: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (rule.negative_pattern) {
        try {
          new RegExp(rule.negative_pattern);
        } catch (err) {
          warnings.push(`Rule "${rule.id}": negative_pattern failed to compile, will be skipped at runtime: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    const output = {
      valid: errors.length === 0,
      rule_count: rules.length,
      validation_errors: errors,
      validation_warnings: warnings,
      storage_path: process.env.HOME ? `${process.env.HOME}/.prompt-optimizer/custom-rules.json` : '~/.prompt-optimizer/custom-rules.json',
    };

    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    process.exit(errors.length === 0 ? 0 : 1);
  }

  // Validate flag conflicts
  if (args.strict && args.relaxed) {
    fatal('--strict and --relaxed are mutually exclusive', args.json);
  }

  // No mixing prompt arg + --file
  if (args.promptArg !== null && args.fileArgs.length > 0) {
    fatal('Cannot mix prompt argument with --file. Use one input mode at a time.', args.json);
  }

  // Compute threshold
  let threshold: number = THRESHOLDS.standard; // default 60
  if (args.threshold !== null) {
    threshold = args.threshold;
  } else if (args.strict) {
    threshold = THRESHOLDS.strict;
  } else if (args.relaxed) {
    threshold = THRESHOLDS.relaxed;
  }

  // Collect prompts to lint
  const prompts: Array<{ source: string; text: string }> = [];

  if (args.fileArgs.length > 0) {
    // File mode
    const files = await resolveFiles(args.fileArgs);
    if (files.length === 0) {
      fatal('No files matched. Check quoting, paths, and that `actions/checkout` ran.', args.json);
    }
    for (const file of files) {
      const text = readFileSync(file, 'utf-8').trim();
      if (text.length === 0) {
        fatal(`File is empty: ${file}`, args.json);
      }
      prompts.push({ source: file, text });
    }
  } else if (args.promptArg !== null) {
    // Argument mode
    const text = args.promptArg.trim();
    if (text.length === 0) {
      fatal('Prompt is empty.', args.json);
    }
    prompts.push({ source: '<argument>', text });
  } else if (!process.stdin.isTTY) {
    // Stdin mode
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const text = Buffer.concat(chunks).toString('utf-8').trim();
    if (text.length === 0) {
      fatal('No prompt provided. Pass as argument, --file, or pipe via stdin.', args.json);
    }
    prompts.push({ source: '<stdin>', text });
  } else {
    // No input at all
    fatal('No prompt provided. Pass as argument, --file, or pipe via stdin.', args.json);
  }

  // Lint all prompts
  const results: LintResult[] = [];
  for (const { source, text } of prompts) {
    results.push(lintPrompt(text, source, threshold));
  }

  const passed = results.filter(r => r.pass).length;
  const failed = results.length - passed;

  // Output
  if (args.json) {
    const output: JsonOutput = {
      version: VERSION,
      threshold,
      results,
      summary: { total: results.length, passed, failed },
    };
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  } else {
    process.stdout.write(`prompt-lint v${VERSION}\n\n`);
    for (const r of results) {
      const icon = r.pass ? '\u2713' : '\u2717';
      const status = r.pass ? 'PASS' : 'FAIL';
      process.stdout.write(`${icon} ${r.source}    score: ${r.score}/100  ${status} (threshold: ${threshold})\n`);
      if (!r.pass && r.issues.length > 0) {
        for (const issue of r.issues) {
          process.stdout.write(`  \u2192 ${issue.rule}: ${issue.message}\n`);
        }
      }
    }
    process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  // Check if --json was in argv for error output format
  const jsonMode = process.argv.includes('--json');
  const message = err instanceof Error ? err.message : String(err);
  fatal(`Unexpected error: ${message}`, jsonMode);
});
