#!/usr/bin/env bash
#
# setup-claude.sh — Install Kanwise as a Claude Code MCP server + kanban-tracking skill.
#
# Two modes:
#
#   ./scripts/setup-claude.sh            Build from source (requires Rust + Node)
#   ./scripts/setup-claude.sh --docker   Use the Docker image (requires Docker)
#
# Both modes configure:
#   - The MCP server in ~/.claude/.mcp.json
#   - The kanban-tracking skill in ~/.claude/skills/
#
set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DIR="$HOME/.local/bin"
MCP_CONFIG="$HOME/.claude/.mcp.json"
SKILL_DST="$HOME/.claude/skills/kanban-tracking"
DB_PATH="$HOME/.kanwise/kanwise.db"
DOCKER_IMAGE="ghcr.io/tienedev/kanwise:latest"
DOCKER_VOLUME="kanwise-data"
SKILL_URL="https://raw.githubusercontent.com/tienedev/kanwise/main/skills/kanban-tracking/SKILL.md"

MODE="source"

# ── Colors ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
err()  { echo -e "  ${RED}✗${NC} $1"; }

# ── Usage ────────────────────────────────────────────────────────────────────
usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Install Kanwise as a Claude Code MCP server with the kanban-tracking skill.

Options:
  --docker    Use the Docker image instead of building from source.
              Requires: Docker installed and running.
              The MCP server runs via "docker run" — no Rust or Node needed.

  --help      Show this help message.

Without flags, the script builds from source (requires Rust and Node.js).

Examples:
  ./scripts/setup-claude.sh              # Build from source
  ./scripts/setup-claude.sh --docker     # Use Docker image

What gets configured:
  MCP config    ~/.claude/.mcp.json      (adds "kanwise" MCP server)
  Skill         ~/.claude/skills/kanban-tracking/SKILL.md
  Database      ~/.kanwise/kanwise.db    (source mode only — Docker uses a volume)
EOF
    exit 0
}

# ── Parse args ───────────────────────────────────────────────────────────────
for arg in "$@"; do
    case "$arg" in
        --docker) MODE="docker" ;;
        --help|-h) usage ;;
        *)
            echo "Unknown option: $arg"
            echo "Run with --help for usage."
            exit 1
            ;;
    esac
done

# ── Header ───────────────────────────────────────────────────────────────────
echo "Kanwise — Claude Code setup"
echo "============================"
echo ""

if [ "$MODE" = "docker" ]; then
    echo "Mode: Docker image ($DOCKER_IMAGE)"
    TOTAL_STEPS=3
else
    echo "Mode: Build from source"
    TOTAL_STEPS=4
fi

step() { echo -e "\n${BLUE}[$1/$TOTAL_STEPS]${NC} $2"; }

# ── Source mode: Build + Install ─────────────────────────────────────────────
if [ "$MODE" = "source" ]; then

    # Step 1: Build
    step 1 "Building kanwise binary..."

    if [ -f "$REPO_DIR/target/release/kanwise" ] && [ "$REPO_DIR/target/release/kanwise" -nt "$REPO_DIR/crates/server/src/main.rs" ]; then
        ok "Binary already up to date, skipping build"
    else
        if [ ! -d "$REPO_DIR/frontend/dist" ]; then
            echo "  Building frontend..."
            (cd "$REPO_DIR/frontend" && npm install --silent && npm run build --silent)
        fi

        echo "  Building backend (release)..."
        (cd "$REPO_DIR" && cargo build --release --quiet)
        ok "Binary built at target/release/kanwise"
    fi

    # Step 2: Install binary
    step 2 "Installing binary to $INSTALL_DIR/"

    mkdir -p "$INSTALL_DIR"
    cp "$REPO_DIR/target/release/kanwise" "$INSTALL_DIR/kanwise"
    chmod +x "$INSTALL_DIR/kanwise"
    ok "Installed kanwise to $INSTALL_DIR/kanwise"

    if ! echo "$PATH" | tr ':' '\n' | grep -q "$INSTALL_DIR"; then
        warn "$INSTALL_DIR is not in your PATH"
        echo "  Add this to your shell profile (~/.zshrc or ~/.bashrc):"
        echo "    export PATH=\"$INSTALL_DIR:\$PATH\""
    fi

    MCP_STEP=3
    SKILL_STEP=4
    MCP_COMMAND="$INSTALL_DIR/kanwise"
    MCP_ARGS='["--mcp"]'
    MCP_ENV="{\"DATABASE_PATH\": \"$DB_PATH\"}"

fi

# ── Docker mode: Pull image ─────────────────────────────────────────────────
if [ "$MODE" = "docker" ]; then

    # Step 1: Check Docker + pull image
    step 1 "Pulling Docker image..."

    if ! command -v docker &>/dev/null; then
        err "Docker is not installed. Install it from https://docs.docker.com/get-docker/"
        exit 1
    fi

    if ! docker info &>/dev/null 2>&1; then
        err "Docker is not running. Please start Docker and try again."
        exit 1
    fi

    docker pull "$DOCKER_IMAGE"
    ok "Image pulled: $DOCKER_IMAGE"

    MCP_STEP=2
    SKILL_STEP=3
    MCP_COMMAND="docker"
    MCP_ARGS='["run", "-i", "--rm", "-v", "'"$DOCKER_VOLUME"':/data", "'"$DOCKER_IMAGE"'", "--mcp"]'
    MCP_ENV='{}'

fi

# ── Configure MCP server (both modes) ───────────────────────────────────────
step "$MCP_STEP" "Configuring MCP server..."

mkdir -p "$(dirname "$MCP_CONFIG")"

if [ "$MODE" = "source" ]; then
    mkdir -p "$(dirname "$DB_PATH")"
fi

if [ -f "$MCP_CONFIG" ]; then
    if grep -q '"kanwise"' "$MCP_CONFIG" 2>/dev/null; then
        ok "MCP server already configured in $MCP_CONFIG"
    else
        TMP=$(mktemp)
        python3 -c "
import json, sys
with open('$MCP_CONFIG') as f:
    config = json.load(f)
config.setdefault('mcpServers', {})['kanwise'] = {
    'command': '$MCP_COMMAND',
    'args': $MCP_ARGS,
    'env': $MCP_ENV
}
json.dump(config, sys.stdout, indent=2)
" > "$TMP"
        mv "$TMP" "$MCP_CONFIG"
        ok "Added kanwise to existing MCP config"
    fi
else
    python3 -c "
import json, sys
config = {
    'mcpServers': {
        'kanwise': {
            'command': '$MCP_COMMAND',
            'args': $MCP_ARGS,
            'env': $MCP_ENV
        }
    }
}
json.dump(config, sys.stdout, indent=2)
" > "$MCP_CONFIG"
    ok "Created MCP config at $MCP_CONFIG"
fi

# ── Install kanban-tracking skill (both modes) ──────────────────────────────
step "$SKILL_STEP" "Installing kanban-tracking skill..."

mkdir -p "$SKILL_DST"

SKILL_SRC="$REPO_DIR/skills/kanban-tracking/SKILL.md"

if [ -f "$SKILL_SRC" ]; then
    # Running from the repo — copy the local file
    cp "$SKILL_SRC" "$SKILL_DST/SKILL.md"
    ok "Skill installed from local repo"
else
    # Running standalone (e.g. Docker mode without the repo) — download from GitHub
    if curl -fsSL "$SKILL_URL" -o "$SKILL_DST/SKILL.md" 2>/dev/null; then
        ok "Skill downloaded from GitHub"
    else
        warn "Could not download skill from $SKILL_URL"
        warn "You can manually copy skills/kanban-tracking/SKILL.md to $SKILL_DST/"
    fi
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}Setup complete!${NC}"
echo ""

if [ "$MODE" = "source" ]; then
    echo "  Database:  $DB_PATH"
    echo "  Binary:    $INSTALL_DIR/kanwise"
else
    echo "  Docker:    $DOCKER_IMAGE"
    echo "  Volume:    $DOCKER_VOLUME:/data"
fi

echo "  MCP:       $MCP_CONFIG"
echo "  Skill:     $SKILL_DST/SKILL.md"
echo ""
echo "Next steps:"
echo "  1. Restart Claude Code to pick up the new MCP server"
echo "  2. Try: \"Create a board called My Project with columns Todo, In Progress, Done\""
echo "  3. Use /kanban-sync anytime to check your board"
echo ""
