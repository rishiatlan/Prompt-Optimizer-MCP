// logger.ts — Structured logging with correlation IDs and prompt safety.
// stderr only (MCP protocol owns stdout).

import { randomUUID } from 'node:crypto';
import type { Logger } from './types.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// ENV controls:
// PROMPT_OPTIMIZER_LOG_LEVEL = 'debug' | 'info' | 'warn' | 'error' (default: 'info')
// PROMPT_OPTIMIZER_LOG_PROMPTS = 'true' (default: unset/false — raw prompts NEVER logged)
const CURRENT_LEVEL = LOG_LEVELS[
  (process.env.PROMPT_OPTIMIZER_LOG_LEVEL as LogLevel) || 'info'
] ?? LOG_LEVELS.info;

const LOG_PROMPTS = process.env.PROMPT_OPTIMIZER_LOG_PROMPTS === 'true';

export function createRequestId(): string {
  return randomUUID();
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= CURRENT_LEVEL;
}

function write(level: string, requestId: string, args: unknown[]): void {
  const msg = args.map(a =>
    typeof a === 'object' ? JSON.stringify(a) : String(a)
  ).join(' ');
  process.stderr.write(`[${level}] [${requestId}] ${msg}\n`);
}

export const log: Logger = {
  debug: (requestId: string, ...args: unknown[]) => {
    if (shouldLog('debug')) write('DEBUG', requestId, args);
  },
  info: (requestId: string, ...args: unknown[]) => {
    if (shouldLog('info')) write('INFO', requestId, args);
  },
  warn: (requestId: string, ...args: unknown[]) => {
    if (shouldLog('warn')) write('WARN', requestId, args);
  },
  error: (requestId: string, ...args: unknown[]) => {
    if (shouldLog('error')) write('ERROR', requestId, args);
  },

  // Special: prompt logging gated behind separate env var + debug level
  prompt: (requestId: string, label: string, content: string) => {
    if (LOG_PROMPTS && shouldLog('debug')) {
      const truncated = content.length > 500 ? content.slice(0, 500) + '...' : content;
      write('DEBUG', requestId, [`[PROMPT] ${label}: ${truncated}`]);
    }
  },
};
