// index.ts — Entry point. Wires MCP server with stdio transport.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';

const server = new McpServer({
  name: 'claude-prompt-optimizer',
  version: '1.0.0',
});

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
