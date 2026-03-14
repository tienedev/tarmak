#!/usr/bin/env bash
#
# setup-claude.sh — Install Kanwise as a Claude Code MCP server + kanban-tracking skill.
#
# What it does:
#   1. Builds the kanwise binary (release mode)
#   2. Installs it to ~/.local/bin/
#   3. Configures the MCP server in ~/.claude/.mcp.json
#   4. Installs the kanban-tracking skill to ~/.claude/skills/
#
# Usage:
#   ./scripts/setup-claude.sh
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DIR="$HOME/.local/bin"
MCP_CONFIG="$HOME/.claude/.mcp.json"
SKILL_SRC="$REPO_DIR/skills/kanban-tracking/SKILL.md"
SKILL_DST="$HOME/.claude/skills/kanban-tracking"
DB_PATH="$HOME/.kanwise/kanwise.db"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

step() { echo -e "\n${BLUE}[$1/4]${NC} $2"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }

echo "Kanwise — Claude Code setup"
echo "============================"

# ── Step 1: Build ────────────────────────────────────────────────────────────
step 1 "Building kanwise binary..."

if [ -f "$REPO_DIR/target/release/kanwise" ] && [ "$REPO_DIR/target/release/kanwise" -nt "$REPO_DIR/crates/server/src/main.rs" ]; then
    ok "Binary already up to date, skipping build"
else
    # Build frontend if dist doesn't exist
    if [ ! -d "$REPO_DIR/frontend/dist" ]; then
        echo "  Building frontend..."
        (cd "$REPO_DIR/frontend" && npm install --silent && npm run build --silent)
    fi

    echo "  Building backend (release)..."
    (cd "$REPO_DIR" && cargo build --release --quiet)
    ok "Binary built at target/release/kanwise"
fi

# ── Step 2: Install binary ───────────────────────────────────────────────────
step 2 "Installing binary to $INSTALL_DIR/"

mkdir -p "$INSTALL_DIR"
cp "$REPO_DIR/target/release/kanwise" "$INSTALL_DIR/kanwise"
chmod +x "$INSTALL_DIR/kanwise"
ok "Installed kanwise to $INSTALL_DIR/kanwise"

# Check PATH
if ! echo "$PATH" | tr ':' '\n' | grep -q "$INSTALL_DIR"; then
    warn "$INSTALL_DIR is not in your PATH"
    echo "  Add this to your shell profile (~/.zshrc or ~/.bashrc):"
    echo "    export PATH=\"$INSTALL_DIR:\$PATH\""
fi

# ── Step 3: Configure MCP server ─────────────────────────────────────────────
step 3 "Configuring MCP server..."

mkdir -p "$(dirname "$DB_PATH")"
mkdir -p "$(dirname "$MCP_CONFIG")"

if [ -f "$MCP_CONFIG" ]; then
    # Check if kanwise is already configured
    if grep -q '"kanwise"' "$MCP_CONFIG" 2>/dev/null; then
        ok "MCP server already configured in $MCP_CONFIG"
    else
        # Merge into existing config using a temp file
        # Read existing, add kanwise server
        TMP=$(mktemp)
        python3 -c "
import json, sys
with open('$MCP_CONFIG') as f:
    config = json.load(f)
config.setdefault('mcpServers', {})['kanwise'] = {
    'command': '$INSTALL_DIR/kanwise',
    'args': ['--mcp'],
    'env': {'DATABASE_PATH': '$DB_PATH'}
}
json.dump(config, sys.stdout, indent=2)
" > "$TMP"
        mv "$TMP" "$MCP_CONFIG"
        ok "Added kanwise to existing MCP config"
    fi
else
    cat > "$MCP_CONFIG" <<MCPEOF
{
  "mcpServers": {
    "kanwise": {
      "command": "$INSTALL_DIR/kanwise",
      "args": ["--mcp"],
      "env": {
        "DATABASE_PATH": "$DB_PATH"
      }
    }
  }
}
MCPEOF
    ok "Created MCP config at $MCP_CONFIG"
fi

# ── Step 4: Install kanban-tracking skill ─────────────────────────────────────
step 4 "Installing kanban-tracking skill..."

mkdir -p "$SKILL_DST"
if [ -f "$SKILL_SRC" ]; then
    cp "$SKILL_SRC" "$SKILL_DST/SKILL.md"
    ok "Skill installed to $SKILL_DST/"
else
    warn "Skill source not found at $SKILL_SRC"
    warn "Copying from ~/.claude/skills/ if available"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo "Kanwise is now available as a Claude Code MCP server."
echo ""
echo "  Database:  $DB_PATH"
echo "  Binary:    $INSTALL_DIR/kanwise"
echo "  MCP:       $MCP_CONFIG"
echo "  Skill:     $SKILL_DST/SKILL.md"
echo ""
echo "Usage:"
echo "  - In Claude Code, the MCP tools (board_query, board_mutate, board_sync) are now available"
echo "  - Use /kanban-sync to manually check your board"
echo "  - The kanban-tracking skill auto-triggers after brainstorming and plan execution"
echo "  - Reset a password: kanwise --reset-password <email>"
echo ""
