#!/usr/bin/env node

// index.ts — Entry point. Wires MCP server with stdio transport.

import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';

// ─── CLI flags ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  const require = createRequire(import.meta.url);
  const pkg = require('../package.json');
  console.log(`claude-prompt-optimizer-mcp v${pkg.version}`);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`claude-prompt-optimizer-mcp — MCP server that optimizes prompts for Claude

Usage:
  claude-prompt-optimizer-mcp          Start the MCP server (stdio transport)
  claude-prompt-optimizer-mcp -v       Print version
  claude-prompt-optimizer-mcp -h       Print this help

Quick setup (Claude Code):
  Add to .mcp.json or ~/.claude/settings.json:
  {
    "mcpServers": {
      "prompt-optimizer": {
        "command": "npx",
        "args": ["-y", "claude-prompt-optimizer-mcp"]
      }
    }
  }

More info: https://github.com/rishiatlan/Claude-Prompt-Optimizer-MCP`);
  process.exit(0);
}

// ─── Server startup ──────────────────────────────────────────────────────────

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const server = new McpServer({
  name: 'claude-prompt-optimizer',
  version: pkg.version,
});

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
