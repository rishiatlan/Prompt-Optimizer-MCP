#!/usr/bin/env node

// index.ts — Entry point. Wires MCP server with storage, rate limiter, and stdio transport.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';
import { LocalFsStorage } from './storage/index.js';
import { LocalRateLimiter } from './rateLimit.js';
import { log, createRequestId } from './logger.js';

// Resolve repo root — works from both src/ (dev) and dist/src/ (compiled)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const findPackageJson = (): string => {
  // Walk up from current file until we find package.json
  const require = createRequire(import.meta.url);
  for (const rel of ['../package.json', '../../package.json']) {
    try { require.resolve(resolve(__dirname, rel)); return resolve(__dirname, rel); } catch { /* next */ }
  }
  return resolve(__dirname, '../package.json'); // fallback
};

// ─── CLI flags ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  const require = createRequire(import.meta.url);
  const pkg = require(findPackageJson());
  console.log(`claude-prompt-optimizer-mcp v${pkg.version}`);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`claude-prompt-optimizer-mcp — Scores, structures, and compiles prompts for any LLM

Usage:
  claude-prompt-optimizer-mcp          Start the MCP server (stdio transport)
  claude-prompt-optimizer-mcp -v       Print version
  claude-prompt-optimizer-mcp -h       Print this help

Environment:
  PROMPT_OPTIMIZER_PRO=true            Enable pro tier (env var override)
  PROMPT_OPTIMIZER_LOG_LEVEL=debug     Log verbosity: debug, info, warn, error
  PROMPT_OPTIMIZER_LOG_PROMPTS=true    Enable raw prompt logging (never in shared envs)

Paid tiers:
  Pro ($4.99/mo)   — 100 optimizations/month, 30/min rate limit
  Power ($9.99/mo) — Unlimited optimizations, 60/min rate limit, always-on mode
  Activate with the set_license tool. Tier priority: license key > env var > free

Quick setup (any MCP-compatible client):
  Add to .mcp.json or ~/.claude/settings.json:
  {
    "mcpServers": {
      "prompt-optimizer": {
        "command": "npx",
        "args": ["-y", "claude-prompt-optimizer-mcp"]
      }
    }
  }

More info: https://github.com/rishiatlan/Prompt-Optimizer-MCP`);
  process.exit(0);
}

// ─── Server startup ──────────────────────────────────────────────────────────

const bootId = createRequestId();
log.info(bootId, 'Starting prompt optimizer MCP server...');

const pkgRequire = createRequire(import.meta.url);
const pkg = pkgRequire(findPackageJson());

// Instance-scoped dependencies (not global mutable state)
const storage = new LocalFsStorage();
const rateLimiter = new LocalRateLimiter();

// Run initial session cleanup
await storage.cleanupSessions();

const server = new McpServer({
  name: 'claude-prompt-optimizer',
  version: pkg.version,
});

registerTools(server, storage, rateLimiter);

const transport = new StdioServerTransport();
await server.connect(transport);

// Log tier from storage (reflects license > env var > default priority)
const bootUsage = await storage.getUsage();
log.info(bootId, `MCP server v${pkg.version} ready (tier=${bootUsage.tier}, tools=15)`);
