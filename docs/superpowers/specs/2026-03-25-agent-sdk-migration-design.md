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
| Plan mode | N/A | Two-pass: `plan` mode first, then `acceptEdits` on approval |
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
│   ├── config.ts         # Claude Code config discovery (port from Rust /config endpoint)
│   ├── detect.ts         # Repo auto-detection (mdfind on macOS, dir scan fallback)
│   ├── callback.ts       # Session completion reporting to Tarmak main server
│   └── types.ts          # Shared message types (WebSocket protocol types)
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
| `/sessions/:id/cancel` | POST | Calls SDK interrupt instead of SIGTERM |
| `/config` | GET | Ported to TS (`config.ts`) — reads Claude Code settings, plugins, skills, MCP servers |
| `/config/set-workdir` | POST | Unchanged |
| `/ws/:sessionId` | WS | **Major upgrade** — bidirectional streaming |

---

## WebSocket Protocol

### Server → Client messages

```typescript
// Agent text output (from SDKAssistantMessage text blocks)
{ type: "assistant", content: string }

// Tool usage notification (from SDKAssistantMessage tool_use blocks)
{ type: "tool_use", tool: string, input: Record<string, unknown> }

// Tool result (from SDKToolUseSummaryMessage or tool_result blocks)
{ type: "tool_result", tool: string, output: string }

// Plan complete — the full plan text from the plan-mode pass
// Sent once when the plan-mode query() finishes
{ type: "plan", content: string }

// Final result (from SDKResultMessage)
{ type: "result", content: string }

// Session status change
{ type: "status", status: "running" | "planning" | "awaiting_approval" | "executing" | "success" | "failed" | "cancelled" }

// Error
{ type: "error", message: string }
```

### Client → Server messages

```typescript
// Approve the plan → starts execution pass
{ type: "approve" }

// Reject the plan → session ends
{ type: "reject" }
```

### Message transformation rules

The `transformMessage()` function maps SDK message types to WebSocket messages:

| SDK Message Type | WebSocket Type | Extraction |
|---|---|---|
| `SDKAssistantMessage` with text content blocks | `assistant` | Concatenate text block contents |
| `SDKAssistantMessage` with tool_use content blocks | `tool_use` | Extract tool name and input |
| `SDKToolUseSummaryMessage` | `tool_result` | Extract tool name and output |
| `SDKResultMessage` | `result` | Extract `.result` string |
| `SDKSystemMessage` (subtype: "init") | Ignored | Used internally to capture session_id |
| `SDKStatusMessage` | `status` | Map to session status |
| All other SDK message types | Ignored | Hooks, retries, etc. — not relevant to UI |

### Reconnection strategy

Messages are buffered server-side per session in `messages: StreamMessage[]`. On WebSocket reconnect, the server replays all buffered messages before resuming the live stream. Buffer is kept until session completion + 5 minutes.

---

## SDK Integration

### Two-pass plan mode

`permissionMode: "plan"` in the SDK is read-only — the agent describes what it would do but never executes tools. This is used as the "planning" phase. If approved, a second `query()` call runs with `permissionMode: "acceptEdits"` to actually execute.

**Behavioral change from current system:** The current PTY system runs with `--dangerously-skip-permissions` (auto-execute everything). The new system requires explicit user approval before code changes. This is a deliberate safety improvement for the PM/PrD audience.

### Session lifecycle

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const SDK_OPTIONS = {
  allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  maxTurns: 50,
  maxBudgetUsd: 5,
  settingSources: ["project"] as const,
};

async function runSession(session: Session, ws: WebSocket) {
  // --- Phase 1: Plan ---
  ws.send(JSON.stringify({ type: "status", status: "planning" }));
  let planText = "";

  for await (const message of query({
    prompt: session.prompt,
    options: {
      cwd: session.worktreePath,
      permissionMode: "plan",
      ...SDK_OPTIONS,
    },
  })) {
    const transformed = transformMessage(message);
    ws.send(JSON.stringify(transformed));
    if ("result" in message) planText = message.result;
  }

  // --- Approval gate ---
  ws.send(JSON.stringify({ type: "plan", content: planText }));
  ws.send(JSON.stringify({ type: "status", status: "awaiting_approval" }));

  const response = await waitForClientMessage(ws);
  if (response.type === "reject") {
    ws.send(JSON.stringify({ type: "status", status: "cancelled" }));
    return;
  }

  // --- Phase 2: Execute ---
  ws.send(JSON.stringify({ type: "status", status: "executing" }));

  for await (const message of query({
    prompt: session.prompt,
    options: {
      cwd: session.worktreePath,
      permissionMode: "acceptEdits",
      ...SDK_OPTIONS,
    },
  })) {
    const transformed = transformMessage(message);
    ws.send(JSON.stringify(transformed));
    bufferMessage(session.id, transformed);
    if ("result" in message) session.log = message.result;
  }

  // --- Notify Tarmak main server ---
  await reportSessionCompletion(session);
}
```

### Session completion callback

When a session finishes (success or failure), the agent server reports back to the Tarmak main server:

```typescript
// callback.ts
async function reportSessionCompletion(session: Session) {
  await fetch(`${TARMAK_SERVER_URL}/api/v1/boards/${session.boardId}/agent-sessions/${session.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serverToken}` },
    body: JSON.stringify({
      status: session.exitCode === 0 ? "success" : "failed",
      exit_code: session.exitCode,
      log: session.log,
      finished_at: new Date().toISOString(),
    }),
  });
}
```

### Prompt construction

Unchanged from current `buildPrompt()` in RunButton — task description, subtasks, ticket/board metadata.

### Crash recovery

On startup, the agent server scans for orphaned worktrees in `<repo>/.worktrees/` and cleans them up. This handles the case where the Node process crashed mid-session.

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
  status: "planning" | "awaiting_approval" | "executing" | "success" | "failed" | "cancelled";
  approve: () => void;
  reject: () => void;
  connected: boolean;
}
```

Connects to `ws://localhost:9876/ws/{sessionId}`, accumulates messages, exposes approve/reject controls. On reconnect, the server replays buffered messages so the UI catches up.

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
