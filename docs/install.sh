#!/usr/bin/env bash
# Claude Prompt Optimizer MCP — Quick Installer
# Usage: curl -fsSL https://rishiatlan.github.io/Prompt-Optimizer-MCP/install.sh | bash

set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${CYAN}${BOLD}Claude Prompt Optimizer MCP${NC}"
echo -e "${CYAN}─────────────────────────────${NC}"
echo ""

# ─── Check Node.js ────────────────────────────────────────────────────────────
if ! command -v node &> /dev/null; then
  echo -e "${RED}✗ Node.js not found.${NC}"
  echo "  Install Node.js 18+ from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/^v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}✗ Node.js $NODE_VERSION found — version 18+ required.${NC}"
  echo "  Upgrade at https://nodejs.org"
  exit 1
fi
echo -e "${GREEN}✓${NC} Node.js $(node -v)"

# ─── Check npm ────────────────────────────────────────────────────────────────
if ! command -v npm &> /dev/null; then
  echo -e "${RED}✗ npm not found.${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} npm $(npm -v)"

# ─── Install ──────────────────────────────────────────────────────────────────
echo ""
echo -e "Installing ${BOLD}claude-prompt-optimizer-mcp${NC} globally..."
npm install -g claude-prompt-optimizer-mcp

echo ""
echo -e "${GREEN}${BOLD}✓ Installed successfully!${NC}"
echo ""

# ─── MCP Config ───────────────────────────────────────────────────────────────
echo -e "Add this to your ${BOLD}claude_desktop_config.json${NC}:"
echo ""
echo -e "${CYAN}"
cat << 'CONFIG'
{
  "mcpServers": {
    "prompt-optimizer": {
      "command": "npx",
      "args": ["-y", "claude-prompt-optimizer-mcp"]
    }
  }
}
CONFIG
echo -e "${NC}"

# ─── Config file location ────────────────────────────────────────────────────
if [[ "$OSTYPE" == "darwin"* ]]; then
  CONFIG_PATH="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  CONFIG_PATH="${XDG_CONFIG_HOME:-$HOME/.config}/Claude/claude_desktop_config.json"
else
  CONFIG_PATH="%APPDATA%\\Claude\\claude_desktop_config.json"
fi

echo -e "Config location: ${BOLD}${CONFIG_PATH}${NC}"
echo ""
echo -e "Run ${BOLD}claude-prompt-optimizer-mcp${NC} to start the MCP server."
echo ""
