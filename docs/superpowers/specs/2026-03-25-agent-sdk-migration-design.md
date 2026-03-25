# Agent SDK Migration + Streaming & Plan Mode

**Date:** 2026-03-25
**Status:** Approved

## Context

Tarmak's current agent architecture spawns Claude Code via osascript/Terminal.app (macOS only), polls exit code files every 500ms, and only shows logs post-mortem. This is fragile, non-portable, and provides no real-time visibility or control.

The target audience — PMs and Product Designers — needs an approachable, in-browser experience with live progress and approval gates before code changes land.

## Goals

1. Replace the PTY/Terminal.app hack with the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
2. Stream agent messages to the frontend in real time via WebSocket
3. Add plan mode: agent proposes a plan, user approves/rejects inline before execution
4. Cross-platform support (no more macOS-only osascript)

## Non-Goals

- Shared/centralized agent server (each user runs their own)
- Subagent orchestration from the UI
- MCP server configuration from the UI
- Inline git diffs in session view

---

## Architecture

### Before

```
Frontend ──HTTP poll 3s──▷ Agent Server (Rust :9876) ──osascript──▷ Terminal.app + claude -p
```

### After

```
Frontend ◁══WebSocket══▷ Agent Server (Node :9876) ◁══subprocess══▷ Claude Code CLI (via SDK)
```

### What changes

| Component | Before | After |
|-----------|--------|-------|
| Agent server | Rust (Axum) | TypeScript (Fastify) |
| Claude Code invocation | osascript → Terminal.app → `claude -p` | SDK `query()` subprocess |
| Output delivery | Log file captured post-mortem | Real-time message streaming via WebSocket |
| Session control | SIGTERM via PID file | `client.interrupt()` via SDK |
| Plan mode | N/A | `permissionMode: "plan"` with inline approval |
| Platform support | macOS only | Cross-platform |

### What stays the same

- Main Tarmak server (Rust, port 4000) — untouched
- Agent session CRUD endpoints in Rust (`api/agent_sessions.rs`)
- SQLite storage for session records
- Frontend components: SessionsPanel, SessionsView, RunButton (upgraded, not replaced)
- Git worktree isolation per session
- Auth token pattern (agent token + Tarmak server token validation)
- Repo URL → workdir cache (`~/.tarmak/repo-cache.json`)

---

## New Package: `agent/`

A new TypeScript package at the repository root:

```
agent/
├── package.json
├── tsconfig.json
├── src/
│   ├── server.ts         # Fastify HTTP + WebSocket server (:9876)
│   ├── sdk.ts            # SDK query() wrapper, message transformation
│   ├── worktree.ts       # Git worktree create/cleanup (port from Rust)
│   ├── repo-cache.ts     # URL → workdir mapping (port from Rust)
│   ├── token.ts          # Agent token generation/validation (port from Rust)
│   └── types.ts          # Shared message types
```

### Dependencies

- `fastify` + `@fastify/websocket` — HTTP and WebSocket server
- `@anthropic-ai/claude-agent-sdk` — Claude Code integration
- `simple-git` — Git worktree operations
- `uuid` — Session ID generation

---

## API Endpoints

All endpoints remain compatible with the existing frontend `agentApi` client.

| Endpoint | Method | Change |
|----------|--------|--------|
| `/health` | GET | Unchanged |
| `/run` | POST | Spawns SDK `query()` instead of PTY |
| `/sessions` | GET | Unchanged |
| `/sessions/:id/cancel` | POST | Calls `client.interrupt()` instead of SIGTERM |
| `/config` | GET | Unchanged (reads Claude Code config files) |
| `/config/set-workdir` | POST | Unchanged |
| `/ws/:sessionId` | WS | **Major upgrade** — bidirectional streaming |

---

## WebSocket Protocol

### Server → Client messages

```typescript
// Agent text output
{ type: "assistant", content: string }

// Thinking block (if adaptive thinking enabled)
{ type: "thinking", content: string }

// Tool usage notification
{ type: "tool_use", tool: string, input: Record<string, unknown> }

// Plan proposal (requires user approval)
{ type: "plan", content: string }

// Final result
{ type: "result", content: string }

// Session status change
{ type: "status", status: "running" | "success" | "failed" | "cancelled" }

// Error
{ type: "error", message: string }
```

### Client → Server messages

```typescript
// Approve a proposed plan
{ type: "approve" }

// Reject a proposed plan (stops the session)
{ type: "reject" }
```

---

## SDK Integration

### Session lifecycle

```typescript
import { query, ClaudeSDKClient } from "@anthropic-ai/claude-agent-sdk";

async function runSession(session: Session, ws: WebSocket) {
  for await (const message of query({
    prompt: session.prompt,
    options: {
      cwd: session.worktreePath,
      permissionMode: "plan",
      allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
      maxTurns: 50,
      maxBudgetUsd: 5,
      settingSources: ["project"],
    },
  })) {
    const transformed = transformMessage(message);
    ws.send(JSON.stringify(transformed));

    // If plan message, wait for user approval
    if (transformed.type === "plan") {
      const response = await waitForClientMessage(ws);
      if (response.type === "reject") {
        // SDK handles cleanup
        break;
      }
    }

    if ("result" in message) {
      session.log = message.result;
    }
  }
}
```

### Prompt construction

Unchanged from current `buildPrompt()` in RunButton — task description, subtasks, ticket/board metadata.

---

## Frontend Changes

### Modified components

| Component | Change |
|-----------|--------|
| `SessionsPanel` | Add "live" mode: render streaming messages instead of static log for running sessions |
| `SessionsView` | Same upgrade — running sessions show live stream, completed show log |
| `SessionCard` | Add `PlanApproval` block (styled card with Approve/Reject buttons) |
| `stores/agent.ts` | Add `messages: Map<string, StreamMessage[]>` for buffering live stream |

### New hook

```typescript
// useSessionStream.ts
function useSessionStream(sessionId: string | null): {
  messages: StreamMessage[];
  status: SessionStatus;
  approve: () => void;
  reject: () => void;
}
```

Connects to `ws://localhost:9876/ws/{sessionId}`, accumulates messages, exposes approve/reject controls.

### No new pages or routes

All changes happen within existing components. No new navigation items.

---

## Rust Changes

### Removed

- `crates/tarmak/src/agent/pty.rs`
- `crates/tarmak/src/agent/detect.rs`
- `crates/tarmak/src/agent/repo_cache.rs`
- `crates/tarmak/src/agent/token.rs`
- `crates/tarmak/src/agent/worktree.rs`
- `crates/tarmak/src/agent/server.rs`

### Kept (main Tarmak server)

- `crates/tarmak/src/api/agent_sessions.rs` — session CRUD
- `crates/tarmak/src/db/` — AgentSession model and queries
- Session cleanup background task

### Adapted

- `crates/tarmak/src/agent/mod.rs` — CLI command now launches the Node server
- `Makefile` — `make agent` runs the TypeScript agent server

---

## Deployment Model

Each user (PM/PrD/Dev) runs the agent server on their own machine:

1. Claude Code CLI installed (via Team plan)
2. Agent server started with `make agent` or `npx tarmak-agent`
3. Tarmak web UI connects to `localhost:9876`

No shared infrastructure needed for the initial rollout.

---

## Scope

### Must-have (presentation)

1. TypeScript agent server with SDK `query()`
2. Live streaming in SessionsPanel and SessionsView
3. Plan mode with inline approval (PlanApproval component)
4. Git worktree isolation (ported from Rust)
5. Auth token compatibility

### Nice-to-have

6. `maxBudgetUsd` display in UI
7. Custom system prompt per board (field in board settings)
8. Prompt templates in RunButton

### Out of scope (v2)

- Shared/centralized agent server
- Subagent workflows from UI
- MCP server configuration from UI
- Inline git diff viewer in sessions
