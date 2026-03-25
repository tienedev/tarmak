# Agent SDK Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the PTY/Terminal.app agent with a TypeScript server using the Claude Agent SDK, adding real-time streaming and plan mode with inline approval.

**Architecture:** New `agent/` TypeScript package (Fastify + WebSocket) replaces Rust agent modules. Frontend upgrades existing SessionsPanel/SessionsView with live streaming via `useSessionStream` hook. Two-pass plan mode: `plan` → approval → `acceptEdits`.

**Tech Stack:** TypeScript, Fastify, @fastify/websocket, @anthropic-ai/claude-agent-sdk, Vitest

**Spec:** `docs/superpowers/specs/2026-03-25-agent-sdk-migration-design.md`

---

## File Structure

### New files (`agent/`)

| File | Responsibility |
|------|---------------|
| `agent/package.json` | Package manifest with dependencies |
| `agent/tsconfig.json` | TypeScript config |
| `agent/src/types.ts` | WebSocket protocol types, session types |
| `agent/src/token.ts` | Agent token generation and file I/O |
| `agent/src/repo-cache.ts` | Repo URL → workdir mapping with JSON persistence |
| `agent/src/worktree.ts` | Git worktree create/cleanup/branch naming |
| `agent/src/detect.ts` | Repo auto-detection (mdfind + directory scan) |
| `agent/src/config.ts` | Claude Code config discovery (settings, MCP, skills) |
| `agent/src/callback.ts` | Session completion reporting to Tarmak server |
| `agent/src/sdk.ts` | SDK query() wrapper, message transformation |
| `agent/src/server.ts` | Fastify HTTP + WebSocket server |
| `agent/src/index.ts` | CLI entry point |
| `agent/tests/token.test.ts` | Token tests |
| `agent/tests/repo-cache.test.ts` | Repo cache tests |
| `agent/tests/worktree.test.ts` | Worktree tests |
| `agent/tests/detect.test.ts` | Detect tests |
| `agent/tests/transform.test.ts` | Message transformation tests |

### New files (`frontend/`)

| File | Responsibility |
|------|---------------|
| `frontend/src/hooks/useSessionStream.ts` | WebSocket streaming hook with approve/reject |
| `frontend/src/components/board/PlanApproval.tsx` | Inline plan approval card |
| `frontend/src/components/board/StreamMessage.tsx` | Renders a single stream message (assistant/tool_use/tool_result) |

### Modified files (`frontend/`)

| File | Change |
|------|--------|
| `frontend/src/stores/agent.ts` | Add `streamMessages` map, new status types |
| `frontend/src/lib/constants.ts` | Add new session status colors (planning, awaiting_approval, executing) |
| `frontend/src/lib/agent.ts` | Update `agentApi.getWsUrl()` — no changes needed (already compatible) |
| `frontend/src/components/board/SessionsPanel.tsx` | Use `useSessionStream` for running sessions |
| `frontend/src/components/board/SessionsView.tsx` | Use `useSessionStream` for running sessions in SessionCard |
| `frontend/src/components/board/BoardSessionsPanel.tsx` | Use new status colors |
| `frontend/src/components/board/SessionIndicator.tsx` | Add planning/executing states |
| `frontend/src/i18n/locales/en.json` | Add new translation keys |
| `frontend/src/i18n/locales/fr.json` | Add new translation keys |

### Modified files (Rust + build)

| File | Change |
|------|--------|
| `Makefile` | Update `make agent` to run TypeScript server |
| `crates/tarmak/src/agent/mod.rs` | Gutted — just re-exports or launches Node |
| `crates/tarmak/src/main.rs` | Agent CLI spawns Node process |

### Deleted files (Rust)

| File | Reason |
|------|--------|
| `crates/tarmak/src/agent/pty.rs` | Replaced by SDK |
| `crates/tarmak/src/agent/server.rs` | Replaced by agent/src/server.ts |
| `crates/tarmak/src/agent/worktree.rs` | Ported to agent/src/worktree.ts |
| `crates/tarmak/src/agent/repo_cache.rs` | Ported to agent/src/repo-cache.ts |
| `crates/tarmak/src/agent/token.rs` | Ported to agent/src/token.ts |
| `crates/tarmak/src/agent/detect.rs` | Ported to agent/src/detect.ts |

---

## Task 1: Scaffold agent/ package

**Files:**
- Create: `agent/package.json`
- Create: `agent/tsconfig.json`
- Create: `agent/src/types.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "tarmak-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.0",
    "@fastify/cors": "^10.0.0",
    "@fastify/websocket": "^11.0.0",
    "fastify": "^5.0.0",
    "uuid": "^11.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/uuid": "^10.0.0",
    "@types/ws": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create types.ts with WebSocket protocol types**

```typescript
// agent/src/types.ts

// --- WebSocket Protocol: Server → Client ---

export type ServerMessage =
  | { type: "assistant"; content: string }
  | { type: "tool_use"; tool: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool: string; output: string }
  | { type: "plan"; content: string }
  | { type: "result"; content: string }
  | { type: "status"; status: SessionStreamStatus }
  | { type: "error"; message: string };

export type SessionStreamStatus =
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "success"
  | "failed"
  | "cancelled";

// --- WebSocket Protocol: Client → Server ---

export type ClientMessage =
  | { type: "approve" }
  | { type: "reject" };

// --- Session ---

export interface Session {
  id: string;
  boardId: string;
  taskId: string;
  branchName: string;
  worktreePath: string;
  prompt: string;
  status: SessionStreamStatus | "running";
  log: string;
  exitCode: number | null;
  messages: ServerMessage[];
}

// --- API types (compatible with existing frontend) ---

export interface RunRequest {
  board_id: string;
  task_id: string;
  prompt: string;
  repo_url: string;
}

export interface RunResponse {
  session_id: string;
  status: string;
  branch_name: string;
  ws_url: string;
}

export interface HealthResponse {
  status: string;
  version: string;
  protocol_version: number;
  sessions_active: number;
}

export interface SessionInfo {
  session_id: string;
  board_id: string;
  task_id: string;
  status: string;
}
```

- [ ] **Step 4: Create agent/.gitignore**

```
node_modules/
dist/
```

- [ ] **Step 5: Install dependencies**

Run: `cd agent && npm install`
Expected: `node_modules/` created, `package-lock.json` generated

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add agent/package.json agent/tsconfig.json agent/src/types.ts agent/.gitignore
git commit -m "feat(agent): scaffold TypeScript agent package with types"
```

---

## Task 2: Port token module

**Files:**
- Create: `agent/src/token.ts`
- Create: `agent/tests/token.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// agent/tests/token.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateToken, saveToken, loadToken, tokenPath } from "../src/token.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("token", () => {
  const testDir = path.join(os.tmpdir(), "tarmak-token-test");

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("generates a 64-char hex token", () => {
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates unique tokens", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });

  it("saves and loads token", async () => {
    const token = generateToken();
    const filepath = path.join(testDir, "agent-token");
    await saveToken(token, filepath);
    const loaded = await loadToken(filepath);
    expect(loaded).toBe(token);
  });

  it("returns null for missing token file", async () => {
    const loaded = await loadToken(path.join(testDir, "nonexistent"));
    expect(loaded).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd agent && npx vitest run tests/token.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement token.ts**

```typescript
// agent/src/token.ts
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";

export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function tokenPath(customPath?: string): string {
  if (customPath) return customPath;
  const dir = path.join(os.homedir(), ".tarmak");
  return path.join(dir, "agent-token");
}

export async function saveToken(
  token: string,
  filepath?: string
): Promise<void> {
  const p = tokenPath(filepath);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, token, "utf-8");
}

export async function loadToken(
  filepath?: string
): Promise<string | null> {
  try {
    const content = await fs.readFile(tokenPath(filepath), "utf-8");
    return content.trim() || null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd agent && npx vitest run tests/token.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add agent/src/token.ts agent/tests/token.test.ts
git commit -m "feat(agent): port token generation module from Rust"
```

---

## Task 3: Port repo-cache module

**Files:**
- Create: `agent/src/repo-cache.ts`
- Create: `agent/tests/repo-cache.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// agent/tests/repo-cache.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RepoCache } from "../src/repo-cache.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("RepoCache", () => {
  const testDir = path.join(os.tmpdir(), "tarmak-cache-test");
  const cachePath = path.join(testDir, "repo-cache.json");

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("starts empty", async () => {
    const cache = await RepoCache.load(cachePath);
    expect(cache.get("https://github.com/foo/bar")).toBeUndefined();
  });

  it("sets and gets a mapping", async () => {
    const cache = await RepoCache.load(cachePath);
    cache.set("https://github.com/foo/bar", "/home/user/bar");
    expect(cache.get("https://github.com/foo/bar")).toBe("/home/user/bar");
  });

  it("persists to disk", async () => {
    const cache = await RepoCache.load(cachePath);
    cache.set("https://github.com/foo/bar", "/home/user/bar");
    await cache.save();

    const cache2 = await RepoCache.load(cachePath);
    expect(cache2.get("https://github.com/foo/bar")).toBe("/home/user/bar");
  });

  it("retains only matching entries", async () => {
    const cache = await RepoCache.load(cachePath);
    cache.set("a", "/exists");
    cache.set("b", "/gone");
    cache.retain((_, workdir) => workdir === "/exists");
    expect(cache.get("a")).toBe("/exists");
    expect(cache.get("b")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd agent && npx vitest run tests/repo-cache.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement repo-cache.ts**

```typescript
// agent/src/repo-cache.ts
import fs from "fs/promises";
import path from "path";
import os from "os";

export class RepoCache {
  private mappings: Map<string, string>;
  private filepath: string;

  private constructor(filepath: string, mappings: Map<string, string>) {
    this.filepath = filepath;
    this.mappings = mappings;
  }

  static defaultPath(): string {
    return path.join(os.homedir(), ".tarmak", "repo-cache.json");
  }

  static async load(filepath?: string): Promise<RepoCache> {
    const p = filepath ?? RepoCache.defaultPath();
    try {
      const raw = await fs.readFile(p, "utf-8");
      const obj = JSON.parse(raw) as Record<string, string>;
      return new RepoCache(p, new Map(Object.entries(obj)));
    } catch {
      return new RepoCache(p, new Map());
    }
  }

  get(repoUrl: string): string | undefined {
    return this.mappings.get(repoUrl);
  }

  set(repoUrl: string, workdir: string): void {
    this.mappings.set(repoUrl, workdir);
  }

  retain(predicate: (url: string, workdir: string) => boolean): void {
    for (const [url, workdir] of this.mappings) {
      if (!predicate(url, workdir)) {
        this.mappings.delete(url);
      }
    }
  }

  entries(): IterableIterator<[string, string]> {
    return this.mappings.entries();
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filepath), { recursive: true });
    const obj = Object.fromEntries(this.mappings);
    await fs.writeFile(this.filepath, JSON.stringify(obj, null, 2), "utf-8");
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd agent && npx vitest run tests/repo-cache.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add agent/src/repo-cache.ts agent/tests/repo-cache.test.ts
git commit -m "feat(agent): port repo cache module from Rust"
```

---

## Task 4: Port worktree module

**Files:**
- Create: `agent/src/worktree.ts`
- Create: `agent/tests/worktree.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// agent/tests/worktree.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { branchName, createWorktree, cleanupWorktree } from "../src/worktree.js";
import { execSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("worktree", () => {
  it("generates correct branch name", () => {
    const name = branchName("task-1234-5678-abcd", "sess-aaaa-bbbb-cccc");
    expect(name).toBe("agent/task-123-sess-aaa");
  });

  describe("create/cleanup", () => {
    let repoDir: string;

    beforeEach(async () => {
      repoDir = path.join(os.tmpdir(), `tarmak-wt-test-${Date.now()}`);
      await fs.mkdir(repoDir, { recursive: true });
      execSync("git init && git commit --allow-empty -m init", {
        cwd: repoDir,
      });
    });

    afterEach(async () => {
      await fs.rm(repoDir, { recursive: true, force: true });
    });

    it("creates and cleans up a worktree", async () => {
      const sessionId = "test-session-id";
      const branch = branchName("task-abcd-1234", sessionId);

      const wtPath = await createWorktree(repoDir, sessionId, branch);
      expect(wtPath).toContain(".worktrees/test-session-id");

      const stat = await fs.stat(wtPath);
      expect(stat.isDirectory()).toBe(true);

      await cleanupWorktree(repoDir, sessionId, branch);

      await expect(fs.stat(wtPath)).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd agent && npx vitest run tests/worktree.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement worktree.ts**

```typescript
// agent/src/worktree.ts
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

const exec = promisify(execFile);

export function branchName(taskId: string, sessionId: string): string {
  const taskShort = taskId.slice(0, 8);
  const sessShort = sessionId.slice(0, 8);
  return `agent/${taskShort}-${sessShort}`;
}

export async function createWorktree(
  repoDir: string,
  sessionId: string,
  branch: string
): Promise<string> {
  const wtDir = path.join(repoDir, ".worktrees", sessionId);
  await ensureGitignore(repoDir);
  await exec("git", ["worktree", "add", wtDir, "-b", branch], {
    cwd: repoDir,
  });
  return wtDir;
}

export async function cleanupWorktree(
  repoDir: string,
  sessionId: string,
  branch: string
): Promise<void> {
  const wtDir = path.join(repoDir, ".worktrees", sessionId);
  try {
    await exec("git", ["worktree", "remove", "--force", wtDir], {
      cwd: repoDir,
    });
  } catch {
    // best-effort
  }
  try {
    await exec("git", ["branch", "-D", branch], { cwd: repoDir });
  } catch {
    // best-effort
  }
}

export async function cleanupOrphanedWorktrees(
  repoDir: string
): Promise<void> {
  const wtBase = path.join(repoDir, ".worktrees");
  try {
    const entries = await fs.readdir(wtBase);
    for (const entry of entries) {
      try {
        await exec("git", ["worktree", "remove", "--force", path.join(wtBase, entry)], {
          cwd: repoDir,
        });
      } catch {
        // skip
      }
    }
  } catch {
    // .worktrees/ doesn't exist — nothing to clean
  }
}

async function ensureGitignore(repoDir: string): Promise<void> {
  const gitignorePath = path.join(repoDir, ".gitignore");
  try {
    const content = await fs.readFile(gitignorePath, "utf-8");
    if (content.includes(".worktrees/")) return;
    await fs.appendFile(gitignorePath, "\n.worktrees/\n");
  } catch {
    await fs.writeFile(gitignorePath, ".worktrees/\n");
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd agent && npx vitest run tests/worktree.test.ts`
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add agent/src/worktree.ts agent/tests/worktree.test.ts
git commit -m "feat(agent): port git worktree module from Rust"
```

---

## Task 5: Port detect module

**Files:**
- Create: `agent/src/detect.ts`
- Create: `agent/tests/detect.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// agent/tests/detect.test.ts
import { describe, it, expect } from "vitest";
import { normalizeUrl } from "../src/detect.js";

describe("detect", () => {
  describe("normalizeUrl", () => {
    it("strips .git suffix", () => {
      expect(normalizeUrl("https://github.com/user/repo.git")).toBe(
        "github.com/user/repo"
      );
    });

    it("converts SSH to canonical form", () => {
      expect(normalizeUrl("git@github.com:user/repo.git")).toBe(
        "github.com/user/repo"
      );
    });

    it("strips protocol", () => {
      expect(normalizeUrl("https://github.com/user/repo")).toBe(
        "github.com/user/repo"
      );
    });

    it("lowercases", () => {
      expect(normalizeUrl("https://GitHub.com/User/REPO")).toBe(
        "github.com/user/repo"
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd agent && npx vitest run tests/detect.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement detect.ts**

```typescript
// agent/src/detect.ts
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import os from "os";
import { RepoCache } from "./repo-cache.js";

const exec = promisify(execFile);

export function normalizeUrl(url: string): string {
  let u = url.trim().toLowerCase();
  // SSH: git@host:user/repo.git → host/user/repo
  const sshMatch = u.match(/^[\w-]+@([^:]+):(.+)$/);
  if (sshMatch) {
    u = `${sshMatch[1]}/${sshMatch[2]}`;
  } else {
    // Strip protocol
    u = u.replace(/^https?:\/\//, "");
  }
  // Strip .git suffix and trailing slash
  u = u.replace(/\.git$/, "").replace(/\/$/, "");
  return u;
}

export async function detectRepos(
  repoUrls: string[],
  cache: RepoCache
): Promise<void> {
  // Prune stale entries (must be synchronous — retain() is not async)
  cache.retain((_, workdir) => existsSync(workdir));

  // Skip URLs already cached
  const needed = repoUrls.filter((url) => !cache.get(url));
  if (needed.length === 0) return;

  const normalizedNeeded = new Map(
    needed.map((url) => [normalizeUrl(url), url])
  );

  const gitDirs = await findGitDirs();
  for (const gitDir of gitDirs) {
    const remoteUrl = await readRemoteUrl(gitDir);
    if (!remoteUrl) continue;

    const normalized = normalizeUrl(remoteUrl);
    const originalUrl = normalizedNeeded.get(normalized);
    if (originalUrl) {
      const repoDir = path.dirname(gitDir);
      cache.set(originalUrl, repoDir);
      normalizedNeeded.delete(normalized);
    }

    if (normalizedNeeded.size === 0) break;
  }

  await cache.save();
}

async function findGitDirs(): Promise<string[]> {
  // Try macOS Spotlight first
  if (process.platform === "darwin") {
    try {
      const { stdout } = await exec("mdfind", [
        'kMDItemFSName == ".git" && kMDItemContentType == "public.folder"',
      ]);
      return stdout
        .split("\n")
        .filter(Boolean)
        .filter((p) => p.endsWith(".git"));
    } catch {
      // fallback
    }
  }

  // Scan common directories
  const home = os.homedir();
  const dirs = [
    "Projects",
    "Projets",
    "Developer",
    "code",
    "repos",
    "src",
  ].map((d) => path.join(home, d));

  const results: string[] = [];
  for (const dir of dirs) {
    await scanForGitDirs(dir, 3, results);
  }
  return results;
}

async function scanForGitDirs(
  dir: string,
  maxDepth: number,
  results: string[]
): Promise<void> {
  if (maxDepth <= 0) return;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "target") {
        if (entry.name === ".git") {
          results.push(path.join(dir, entry.name));
        }
        continue;
      }
      await scanForGitDirs(path.join(dir, entry.name), maxDepth - 1, results);
    }
  } catch {
    // permission denied, etc.
  }
}

async function readRemoteUrl(gitDir: string): Promise<string | null> {
  try {
    const configPath = path.join(gitDir, "config");
    const content = await fs.readFile(configPath, "utf-8");
    const match = content.match(/\[remote "origin"\][^[]*url\s*=\s*(.+)/);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd agent && npx vitest run tests/detect.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add agent/src/detect.ts agent/tests/detect.test.ts
git commit -m "feat(agent): port repo detection module from Rust"
```

---

## Task 6: Port config module

**Files:**
- Create: `agent/src/config.ts`

This ports the complex `/config` endpoint logic from Rust `server.rs` lines 629-702.
No unit tests — this is file-system introspection that's best tested via integration.

- [ ] **Step 1: Implement config.ts**

Port the Rust config aggregation logic. The module reads:
1. Global Claude Code settings (`~/.claude.json` or `~/.claude/settings.json`)
2. MCP servers from 4 scopes (global, user, project, local)
3. Installed plugins from `~/.claude/installed_plugins.json`
4. Skills by scanning plugin directories for `SKILL.md` files
5. Hooks from project `.claude/settings.json`
6. Per-project `CLAUDE.md` and settings

```typescript
// agent/src/config.ts
import fs from "fs/promises";
import path from "path";
import os from "os";

export interface McpServer {
  name: string;
  scope: "global" | "user" | "project" | "local";
  command: string | null;
  args: string[] | null;
}

export interface SkillInfo {
  name: string;
  description: string;
  dir: string;
  plugin: string;
  enabled: boolean;
}

export interface ProjectConfig {
  repo_url: string;
  workdir: string;
  claude_md: string | null;
  settings: Record<string, unknown> | null;
  mcp_servers: McpServer[];
  skills: SkillInfo[];
}

export interface AgentConfig {
  global: {
    settings: Record<string, unknown> | null;
    mcp_servers: Record<string, unknown> | null;
  };
  plugins: Record<string, unknown[]> | null;
  skills: SkillInfo[];
  hooks: Record<string, unknown[]> | null;
  projects: ProjectConfig[];
  stats: {
    totalSessions: number | null;
    totalMessages: number | null;
    modelUsage: Record<string, unknown> | null;
  } | null;
}

export async function getConfig(
  workdirs: Map<string, string>
): Promise<AgentConfig> {
  const claudeDir = path.join(os.homedir(), ".claude");

  // Global settings
  const globalSettings = await readJsonSafe(
    path.join(claudeDir, "settings.json")
  );

  // Global MCP servers
  const globalMcp =
    (globalSettings?.mcpServers as Record<string, unknown>) ?? null;

  // Installed plugins
  const plugins = await readJsonSafe(
    path.join(claudeDir, "installed_plugins.json")
  );

  // Skills from plugins
  const skills = await discoverSkills(claudeDir);

  // Per-project configs
  const projects: ProjectConfig[] = [];
  for (const [repoUrl, workdir] of workdirs) {
    const projectClaudeMd = await readFileSafe(
      path.join(workdir, "CLAUDE.md")
    );
    const projectSettings = await readJsonSafe(
      path.join(workdir, ".claude", "settings.json")
    );
    const projectMcp = await discoverMcpServers(workdir);
    const projectSkills = await discoverProjectSkills(workdir, claudeDir);

    projects.push({
      repo_url: repoUrl,
      workdir,
      claude_md: projectClaudeMd,
      settings: projectSettings,
      mcp_servers: projectMcp,
      skills: projectSkills,
    });
  }

  return {
    global: { settings: globalSettings, mcp_servers: globalMcp },
    plugins,
    skills,
    hooks: (globalSettings?.hooks as Record<string, unknown[]>) ?? null,
    projects,
    stats: null,
  };
}

async function discoverSkills(claudeDir: string): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];
  const pluginsFile = path.join(claudeDir, "installed_plugins.json");
  try {
    const raw = await fs.readFile(pluginsFile, "utf-8");
    const installed = JSON.parse(raw) as Record<string, unknown[]>;
    const cacheDir = path.join(claudeDir, "plugins", "cache");

    for (const [pluginName, _] of Object.entries(installed)) {
      const skillsDir = path.join(cacheDir, pluginName, "skills");
      try {
        const entries = await fs.readdir(skillsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const skillMd = path.join(skillsDir, entry.name, "SKILL.md");
          try {
            const content = await fs.readFile(skillMd, "utf-8");
            const nameLine = content.match(/^name:\s*(.+)$/m);
            const descLine = content.match(/^description:\s*(.+)$/m);
            skills.push({
              name: nameLine?.[1]?.trim() ?? entry.name,
              description: descLine?.[1]?.trim() ?? "",
              dir: path.join(skillsDir, entry.name),
              plugin: pluginName,
              enabled: true,
            });
          } catch {
            // no SKILL.md
          }
        }
      } catch {
        // no skills dir
      }
    }
  } catch {
    // no plugins file
  }
  return skills;
}

async function discoverMcpServers(workdir: string): Promise<McpServer[]> {
  const servers: McpServer[] = [];
  const settingsPath = path.join(workdir, ".claude", "settings.json");
  try {
    const raw = await fs.readFile(settingsPath, "utf-8");
    const settings = JSON.parse(raw);
    const mcp = settings?.mcpServers as Record<string, { command?: string; args?: string[] }> | undefined;
    if (mcp) {
      for (const [name, cfg] of Object.entries(mcp)) {
        servers.push({
          name,
          scope: "project",
          command: cfg.command ?? null,
          args: cfg.args ?? null,
        });
      }
    }
  } catch {
    // no settings
  }
  return servers;
}

async function discoverProjectSkills(
  _workdir: string,
  _claudeDir: string
): Promise<SkillInfo[]> {
  // Project-scoped skills discovery — simplified for now
  return [];
}

async function readJsonSafe(
  filepath: string
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filepath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readFileSafe(filepath: string): Promise<string | null> {
  try {
    return await fs.readFile(filepath, "utf-8");
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add agent/src/config.ts
git commit -m "feat(agent): port config discovery module from Rust"
```

---

## Task 7: Implement callback module

**Files:**
- Create: `agent/src/callback.ts`

- [ ] **Step 1: Implement callback.ts**

```typescript
// agent/src/callback.ts
import type { Session } from "./types.js";

export async function reportSessionCreated(
  serverUrl: string,
  serverToken: string,
  session: Session
): Promise<void> {
  try {
    await fetch(`${serverUrl}/api/v1/boards/${session.boardId}/agent-sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serverToken}`,
      },
      body: JSON.stringify({
        id: session.id,
        board_id: session.boardId,
        task_id: session.taskId,
        status: "running",
        branch_name: session.branchName,
      }),
    });
  } catch {
    // fire-and-forget — matching Rust behavior
  }
}

export async function reportSessionCompleted(
  serverUrl: string,
  serverToken: string,
  session: Session
): Promise<void> {
  const status =
    session.status === "cancelled"
      ? "cancelled"
      : session.exitCode === 0
        ? "success"
        : "failed";

  try {
    await fetch(
      `${serverUrl}/api/v1/boards/${session.boardId}/agent-sessions/${session.id}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serverToken}`,
        },
        body: JSON.stringify({
          status,
          exit_code: session.exitCode,
          log: session.log,
          finished_at: new Date().toISOString(),
        }),
      }
    );
  } catch {
    // best-effort
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add agent/src/callback.ts
git commit -m "feat(agent): add session completion callback module"
```

---

## Task 8: Implement SDK wrapper with message transformation

**Files:**
- Create: `agent/src/sdk.ts`
- Create: `agent/tests/transform.test.ts`

- [ ] **Step 1: Write failing tests for transformMessage**

```typescript
// agent/tests/transform.test.ts
import { describe, it, expect } from "vitest";
import { transformMessage, transformMessageAll } from "../src/sdk.js";

describe("transformMessage", () => {
  it("transforms result message", () => {
    const msg = { type: "result", subtype: "success", result: "Done. 2 files modified." };
    const result = transformMessage(msg);
    expect(result).toEqual({ type: "result", content: "Done. 2 files modified." });
  });

  it("returns null for system init messages", () => {
    const msg = { type: "system", subtype: "init", session_id: "abc" };
    const result = transformMessage(msg);
    expect(result).toBeNull();
  });

  it("transforms tool use summary (tool result) message", () => {
    const msg = {
      type: "tool_use_summary",
      tool_name: "Edit",
      tool_input: { file_path: "src/foo.ts" },
      output: "File edited successfully",
    };
    const result = transformMessage(msg);
    expect(result).toEqual({ type: "tool_result", tool: "Edit", output: "File edited successfully" });
  });

  it("returns null for unknown message types", () => {
    const msg = { type: "hook_progress", data: {} };
    const result = transformMessage(msg);
    expect(result).toBeNull();
  });
});

describe("transformMessageAll", () => {
  it("extracts both text and tool_use from assistant message", () => {
    const msg = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "I'll edit this file." },
          { type: "tool_use", name: "Edit", input: { file_path: "src/foo.ts" } },
        ],
      },
    };
    const results = transformMessageAll(msg);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ type: "assistant", content: "I'll edit this file." });
    expect(results[1]).toEqual({
      type: "tool_use",
      tool: "Edit",
      input: { file_path: "src/foo.ts" },
    });
  });

  it("handles tool_use_summary message", () => {
    const msg = {
      type: "tool_use_summary",
      tool_name: "Bash",
      output: "npm test passed",
    };
    const results = transformMessageAll(msg);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ type: "tool_result", tool: "Bash", output: "npm test passed" });
  });

  it("returns empty array for unknown types", () => {
    expect(transformMessageAll({ type: "hook_progress" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd agent && npx vitest run tests/transform.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement sdk.ts**

```typescript
// agent/src/sdk.ts
import type { ServerMessage, Session, SessionStreamStatus } from "./types.js";
import type { WebSocket } from "ws";

// Transform SDK messages to our WebSocket protocol.
// The SDK message types are loosely typed — we pattern-match on known shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformMessage(message: any): ServerMessage | null {
  if (!message || typeof message !== "object") return null;

  // ResultMessage — has .result string
  if ("result" in message && typeof message.result === "string") {
    return { type: "result", content: message.result };
  }

  // SystemMessage — init, ignore
  if (message.type === "system") {
    return null;
  }

  // ToolUseSummaryMessage — tool execution result
  if (message.type === "tool_use_summary") {
    return {
      type: "tool_result",
      tool: message.tool_name ?? "unknown",
      output: typeof message.output === "string" ? message.output : JSON.stringify(message.output ?? ""),
    };
  }

  // AssistantMessage — has .message.content array (Anthropic BetaMessage shape)
  if (message.type === "assistant" && message.message?.content) {
    const blocks = message.message.content;
    const texts: string[] = [];
    const toolUses: ServerMessage[] = [];

    for (const block of blocks) {
      if (block.type === "text" && block.text) {
        texts.push(block.text);
      } else if (block.type === "tool_use") {
        toolUses.push({
          type: "tool_use",
          tool: block.name ?? "unknown",
          input: block.input ?? {},
        });
      }
    }

    // Return text first if present, tool uses get sent separately
    if (texts.length > 0) {
      return { type: "assistant", content: texts.join("\n") };
    }
    if (toolUses.length > 0) {
      return toolUses[0]; // first tool_use; caller should handle multiple
    }
    return null;
  }

  // PartialAssistantMessage (streaming) — simpler shape
  if (message.type === "assistant" && typeof message.content === "string") {
    return { type: "assistant", content: message.content };
  }

  // Ignore everything else (hooks, retries, status, etc.)
  return null;
}

// Extract all server messages from a single SDK message
// (an assistant message can contain both text and multiple tool_use blocks)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformMessageAll(message: any): ServerMessage[] {
  if (!message || typeof message !== "object") return [];

  if ("result" in message && typeof message.result === "string") {
    return [{ type: "result", content: message.result }];
  }

  if (message.type === "system") return [];

  // ToolUseSummaryMessage — tool execution result
  if (message.type === "tool_use_summary") {
    return [{
      type: "tool_result",
      tool: message.tool_name ?? "unknown",
      output: typeof message.output === "string" ? message.output : JSON.stringify(message.output ?? ""),
    }];
  }

  if (message.type === "assistant" && message.message?.content) {
    const results: ServerMessage[] = [];
    for (const block of message.message.content) {
      if (block.type === "text" && block.text) {
        results.push({ type: "assistant", content: block.text });
      } else if (block.type === "tool_use") {
        results.push({
          type: "tool_use",
          tool: block.name ?? "unknown",
          input: block.input ?? {},
        });
      }
    }
    return results;
  }

  return [];
}

export function sendMessage(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function waitForClientMessage(
  ws: WebSocket
): Promise<{ type: string }> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: Buffer) => {
      try {
        const parsed = JSON.parse(data.toString());
        ws.off("message", onMessage);
        ws.off("close", onClose);
        resolve(parsed);
      } catch {
        // ignore malformed messages
      }
    };
    const onClose = () => {
      ws.off("message", onMessage);
      reject(new Error("WebSocket closed while waiting for approval"));
    };
    ws.on("message", onMessage);
    ws.on("close", onClose);
  });
}
```

- [ ] **Step 4: Run tests**

Run: `cd agent && npx vitest run tests/transform.test.ts`
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add agent/src/sdk.ts agent/tests/transform.test.ts
git commit -m "feat(agent): add SDK wrapper with message transformation"
```

---

## Task 9: Implement Fastify server

**Files:**
- Create: `agent/src/server.ts`
- Create: `agent/src/index.ts`

This is the core of the migration — the Fastify server with all endpoints.

- [ ] **Step 1: Implement server.ts**

```typescript
// agent/src/server.ts
import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import { v4 as uuidv4 } from "uuid";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { WebSocket } from "ws";

import type { Session, RunRequest, RunResponse, HealthResponse, SessionInfo, ServerMessage } from "./types.js";
import { generateToken, loadToken, saveToken } from "./token.js";
import { RepoCache } from "./repo-cache.js";
import { branchName, createWorktree, cleanupWorktree, cleanupOrphanedWorktrees } from "./worktree.js";
import { detectRepos } from "./detect.js";
import { getConfig } from "./config.js";
import { reportSessionCreated, reportSessionCompleted } from "./callback.js";
import { transformMessageAll, sendMessage, waitForClientMessage } from "./sdk.js";

interface StartOptions {
  serverUrl: string;
  serverToken: string;
  port: number;
  allowedOrigins: string[];
}

const SDK_OPTIONS = {
  allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"] as const,
  maxTurns: 50,
  maxBudgetUsd: 5,
  settingSources: ["project"] as const,
};

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function startServer(opts: StartOptions): Promise<void> {
  // Load or generate agent token
  let agentToken = await loadToken();
  if (!agentToken) {
    agentToken = generateToken();
    await saveToken(agentToken);
  }

  const repoCache = await RepoCache.load();
  const sessions = new Map<string, Session>();
  const validatedTokens = new Map<string, number>(); // token → timestamp
  const sessionWs = new Map<string, Set<WebSocket>>(); // sessionId → connected clients

  // Cleanup orphaned worktrees from previous crashes
  for (const [, workdir] of repoCache.entries()) {
    await cleanupOrphanedWorktrees(workdir);
  }

  const app = Fastify({ logger: false });
  await app.register(fastifyCors, { origin: opts.allowedOrigins });
  await app.register(fastifyWebsocket);

  // --- Auth middleware ---
  async function validateToken(token: string): Promise<boolean> {
    if (!token) return false;
    // Fast path: known tokens
    if (token === agentToken || token === opts.serverToken) return true;
    // Cache check
    const cached = validatedTokens.get(token);
    if (cached && Date.now() - cached < TOKEN_TTL_MS) return true;
    // HTTP validation
    try {
      const res = await fetch(`${opts.serverUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        validatedTokens.set(token, Date.now());
        return true;
      }
    } catch { /* validation failed */ }
    return false;
  }

  function extractToken(authHeader: string | undefined): string {
    if (!authHeader) return "";
    return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  }

  app.addHook("onRequest", async (request, reply) => {
    // Skip auth for health and WebSocket upgrade
    if (request.url === "/health") return;
    if (request.url.startsWith("/ws/")) return; // WS auth handled in handler

    const token = extractToken(request.headers.authorization);
    if (!(await validateToken(token))) {
      reply.code(401).send({ error: "Unauthorized" });
    }
  });

  // --- GET /health ---
  app.get("/health", async () => {
    return {
      status: "ok",
      version: "0.1.0",
      protocol_version: 2,
      sessions_active: sessions.size,
    } satisfies HealthResponse;
  });

  // --- GET /sessions ---
  app.get("/sessions", async () => {
    const list: SessionInfo[] = [];
    for (const [id, s] of sessions) {
      list.push({
        session_id: id,
        board_id: s.boardId,
        task_id: s.taskId,
        status: s.status,
      });
    }
    return list;
  });

  // --- POST /run ---
  app.post<{ Body: RunRequest }>("/run", async (request, reply) => {
    const { board_id, task_id, prompt, repo_url } = request.body;

    // Resolve workdir
    let workdir = repoCache.get(repo_url);
    if (!workdir) {
      await detectRepos([repo_url], repoCache);
      workdir = repoCache.get(repo_url);
    }
    if (!workdir) {
      return reply.code(400).send({
        error: "Repository not found on this machine",
        hint: `Use POST /config/set-workdir to register the local path for ${repo_url}`,
      });
    }

    const sessionId = uuidv4();
    const branch = branchName(task_id, sessionId);

    let worktreePath: string;
    try {
      worktreePath = await createWorktree(workdir, sessionId, branch);
    } catch (err) {
      return reply.code(500).send({
        error: `Failed to create worktree: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const session: Session = {
      id: sessionId,
      boardId: board_id,
      taskId: task_id,
      branchName: branch,
      worktreePath,
      prompt,
      status: "planning",
      log: "",
      exitCode: null,
      messages: [],
    };
    sessions.set(sessionId, session);

    // Report to Tarmak main server (fire-and-forget)
    reportSessionCreated(opts.serverUrl, opts.serverToken, session);

    // Run session in background (don't await)
    runSession(session).catch((err) => {
      console.error(`Session ${sessionId} error:`, err);
      session.status = "failed";
      session.exitCode = 1;
      broadcastToSession(sessionId, { type: "error", message: String(err) });
      broadcastToSession(sessionId, { type: "status", status: "failed" });
    });

    const wsUrl = `ws://localhost:${opts.port}/ws/${sessionId}`;
    return {
      session_id: sessionId,
      status: "running",
      branch_name: branch,
      ws_url: wsUrl,
    } satisfies RunResponse;
  });

  // --- POST /sessions/:id/cancel ---
  app.post<{ Params: { id: string } }>("/sessions/:id/cancel", async (request, reply) => {
    const session = sessions.get(request.params.id);
    if (!session) return reply.code(404).send({ error: "Session not found" });
    session.status = "cancelled";
    broadcastToSession(session.id, { type: "status", status: "cancelled" });
    return { status: "cancelled" };
  });

  // --- GET /config ---
  app.get("/config", async () => {
    const workdirs = new Map<string, string>();
    for (const [url, dir] of repoCache.entries()) {
      workdirs.set(url, dir);
    }
    return getConfig(workdirs);
  });

  // --- POST /config/set-workdir ---
  app.post<{ Body: { repo_url: string; workdir: string } }>("/config/set-workdir", async (request) => {
    const { repo_url, workdir } = request.body;
    repoCache.set(repo_url, workdir);
    await repoCache.save();
    return { status: "ok" };
  });

  // --- WS /ws/:sessionId ---
  app.register(async (fastify) => {
    fastify.get<{ Params: { sessionId: string } }>("/ws/:sessionId", { websocket: true }, async (socket, request) => {
      const { sessionId } = request.params;

      // Auth check
      const token = extractToken(request.headers.authorization)
        || new URL(request.url, "http://localhost").searchParams.get("token")
        || "";
      if (!(await validateToken(token))) {
        socket.close(4001, "Unauthorized");
        return;
      }

      const session = sessions.get(sessionId);
      if (!session) {
        socket.close(4004, "Session not found");
        return;
      }

      // Register WebSocket for broadcasts
      if (!sessionWs.has(sessionId)) sessionWs.set(sessionId, new Set());
      sessionWs.get(sessionId)!.add(socket);

      // Replay buffered messages
      for (const msg of session.messages) {
        sendMessage(socket, msg);
      }

      socket.on("close", () => {
        sessionWs.get(sessionId)?.delete(socket);
      });
    });
  });

  // --- Helpers ---
  function broadcastToSession(sessionId: string, msg: ServerMessage): void {
    const session = sessions.get(sessionId);
    if (session) session.messages.push(msg);

    const clients = sessionWs.get(sessionId);
    if (!clients) return;
    for (const ws of clients) {
      sendMessage(ws, msg);
    }
  }

  async function runSession(session: Session): Promise<void> {
    // --- Phase 1: Plan ---
    broadcastToSession(session.id, { type: "status", status: "planning" });
    let planText = "";

    for await (const message of query({
      prompt: session.prompt,
      options: {
        cwd: session.worktreePath,
        permissionMode: "plan",
        ...SDK_OPTIONS,
      },
    })) {
      if (session.status === "cancelled") return;
      const transformed = transformMessageAll(message);
      for (const msg of transformed) {
        broadcastToSession(session.id, msg);
      }
      if ("result" in message && typeof message.result === "string") {
        planText = message.result;
      }
    }

    if (session.status === "cancelled") return;

    // --- Approval gate ---
    broadcastToSession(session.id, { type: "plan", content: planText });
    broadcastToSession(session.id, { type: "status", status: "awaiting_approval" });
    session.status = "awaiting_approval";

    // Wait for any connected client to approve/reject
    const response = await waitForApproval(session.id);
    if (!response || response.type === "reject" || session.status === "cancelled") {
      session.status = "cancelled";
      session.exitCode = 0;
      broadcastToSession(session.id, { type: "status", status: "cancelled" });
      await cleanupSession(session);
      return;
    }

    // --- Phase 2: Execute ---
    session.status = "executing";
    broadcastToSession(session.id, { type: "status", status: "executing" });

    for await (const message of query({
      prompt: session.prompt,
      options: {
        cwd: session.worktreePath,
        permissionMode: "acceptEdits",
        ...SDK_OPTIONS,
      },
    })) {
      if (session.status === "cancelled") return;
      const transformed = transformMessageAll(message);
      for (const msg of transformed) {
        broadcastToSession(session.id, msg);
      }
      if ("result" in message && typeof message.result === "string") {
        session.log = message.result;
      }
    }

    session.status = "success";
    session.exitCode = 0;
    broadcastToSession(session.id, { type: "status", status: "success" });
    await cleanupSession(session);
  }

  function waitForApproval(sessionId: string): Promise<{ type: string } | null> {
    return new Promise((resolve) => {
      const clients = sessionWs.get(sessionId);
      if (!clients || clients.size === 0) {
        // No clients connected — wait for one
        const checkInterval = setInterval(() => {
          const session = sessions.get(sessionId);
          if (session?.status === "cancelled") {
            clearInterval(checkInterval);
            resolve(null);
            return;
          }
          const c = sessionWs.get(sessionId);
          if (c && c.size > 0) {
            clearInterval(checkInterval);
            listenForApproval(sessionId, resolve);
          }
        }, 500);
        // Timeout after 10 minutes
        setTimeout(() => { clearInterval(checkInterval); resolve(null); }, 600_000);
        return;
      }
      listenForApproval(sessionId, resolve);
    });
  }

  function listenForApproval(sessionId: string, resolve: (msg: { type: string } | null) => void): void {
    const clients = sessionWs.get(sessionId);
    if (!clients) { resolve(null); return; }

    for (const ws of clients) {
      const handler = (data: Buffer) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === "approve" || parsed.type === "reject") {
            // Remove handler from all clients
            for (const c of clients) c.off("message", handler);
            resolve(parsed);
          }
        } catch { /* ignore */ }
      };
      ws.on("message", handler);
    }
  }

  async function cleanupSession(session: Session): Promise<void> {
    // Report to Tarmak main server
    await reportSessionCompleted(opts.serverUrl, opts.serverToken, session);

    // Schedule message buffer cleanup (keep for 5 min after completion)
    setTimeout(() => {
      sessions.delete(session.id);
      sessionWs.delete(session.id);
    }, 5 * 60 * 1000);

    // Cleanup worktree
    try {
      // Find the repo dir (parent of .worktrees)
      const repoDir = session.worktreePath.split("/.worktrees/")[0];
      await cleanupWorktree(repoDir, session.id, session.branchName);
    } catch {
      // best-effort
    }
  }

  // --- Start ---
  await app.listen({ port: opts.port, host: "0.0.0.0" });
  console.log(`Agent server listening on port ${opts.port}`);
  console.log(`Agent token: ${agentToken}`);
}
```

- [ ] **Step 2: Implement index.ts (CLI entry point)**

```typescript
// agent/src/index.ts
import { startServer } from "./server.js";

const serverUrl = process.argv.find((_, i, a) => a[i - 1] === "--server") ?? "http://localhost:4000";
const token = process.argv.find((_, i, a) => a[i - 1] === "--token") ?? "";
const port = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--port") ?? "9876", 10);
const origins = (process.argv.find((_, i, a) => a[i - 1] === "--allowed-origins") ?? "http://localhost:3000,http://localhost:4000").split(",");

startServer({ serverUrl, serverToken: token, port, allowedOrigins: origins });
```

- [ ] **Step 3: Verify it compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Manual smoke test**

Run: `cd agent && npx tsx src/index.ts --server http://localhost:4000 --token test --port 9876`
Expected: Server starts, `GET /health` returns 200 with `{ status: "ok" }`

Verify: `curl http://localhost:9876/health`

- [ ] **Step 5: Commit**

```bash
git add agent/src/server.ts agent/src/index.ts
git commit -m "feat(agent): implement Fastify server with all endpoints"
```

---

## Task 10: Update frontend constants and agent store

**Files:**
- Modify: `frontend/src/lib/constants.ts`
- Modify: `frontend/src/stores/agent.ts`

- [ ] **Step 1: Add new status colors to constants.ts**

Add colors for the new session statuses (`planning`, `awaiting_approval`, `executing`):

```typescript
// Add to SESSION_STATUS_COLORS:
planning: 'bg-blue-500/10 text-blue-500',
awaiting_approval: 'bg-amber-500/10 text-amber-500',
executing: 'bg-green-500/10 text-green-500',
```

- [ ] **Step 2: Add stream messages to agent store**

Add `streamMessages` map to `useAgentStore`:

```typescript
// New state fields:
streamMessages: new Map<string, StreamMessage[]>()
streamStatuses: new Map<string, string>()

// New methods:
appendStreamMessage: (sessionId: string, message: StreamMessage) => void
setStreamStatus: (sessionId: string, status: string) => void
clearStream: (sessionId: string) => void
```

Where `StreamMessage` matches the `ServerMessage` type from `agent/src/types.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/constants.ts frontend/src/stores/agent.ts
git commit -m "feat(frontend): add streaming state to agent store"
```

---

## Task 11: Implement useSessionStream hook

**Files:**
- Create: `frontend/src/hooks/useSessionStream.ts`

- [ ] **Step 1: Implement the hook**

```typescript
// frontend/src/hooks/useSessionStream.ts
import { useEffect, useRef, useCallback, useState } from "react";
import { agentApi } from "@/lib/agent";
import { useAgentStore } from "@/stores/agent";

export interface StreamMessage {
  type: "assistant" | "tool_use" | "tool_result" | "plan" | "result" | "status" | "error";
  content?: string;
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
  message?: string;
  status?: string;
}

export function useSessionStream(sessionId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const { streamMessages, streamStatuses, appendStreamMessage, setStreamStatus } = useAgentStore();

  const messages = sessionId ? streamMessages.get(sessionId) ?? [] : [];
  const status = sessionId ? streamStatuses.get(sessionId) ?? "running" : "running";

  useEffect(() => {
    if (!sessionId) return;

    const url = agentApi.getWsUrl(sessionId);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (event) => {
      try {
        const msg: StreamMessage = JSON.parse(event.data);
        if (msg.type === "status" && msg.status) {
          setStreamStatus(sessionId, msg.status);
        } else {
          appendStreamMessage(sessionId, msg);
        }
      } catch {
        // ignore malformed
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [sessionId, appendStreamMessage, setStreamStatus]);

  const approve = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "approve" }));
  }, []);

  const reject = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "reject" }));
  }, []);

  return { messages, status, approve, reject, connected };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useSessionStream.ts
git commit -m "feat(frontend): add useSessionStream WebSocket hook"
```

---

## Task 12: Create StreamMessage and PlanApproval components

**Files:**
- Create: `frontend/src/components/board/StreamMessage.tsx`
- Create: `frontend/src/components/board/PlanApproval.tsx`

- [ ] **Step 1: Implement StreamMessage.tsx**

Renders a single stream message. Types: `assistant` (text), `tool_use` (tool name + file), `tool_result` (output), `result` (final), `error` (red text).

```typescript
// frontend/src/components/board/StreamMessage.tsx
import type { StreamMessage as StreamMessageType } from "@/hooks/useSessionStream";

export function StreamMessage({ message }: { message: StreamMessageType }) {
  switch (message.type) {
    case "assistant":
      return (
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
      );
    case "tool_use":
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">✎ {message.tool}</span>
          {message.input?.file_path && (
            <span className="truncate">{String(message.input.file_path)}</span>
          )}
        </div>
      );
    case "tool_result":
      return (
        <div className="text-xs text-muted-foreground/70 font-mono truncate">
          → {message.output}
        </div>
      );
    case "result":
      return (
        <div className="text-sm font-medium text-green-600 dark:text-green-400">
          {message.content}
        </div>
      );
    case "error":
      return (
        <div className="text-sm text-red-500">{message.message}</div>
      );
    default:
      return null;
  }
}
```

- [ ] **Step 2: Implement PlanApproval.tsx**

```typescript
// frontend/src/components/board/PlanApproval.tsx
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";

interface PlanApprovalProps {
  plan: string;
  onApprove: () => void;
  onReject: () => void;
}

export function PlanApproval({ plan, onApprove, onReject }: PlanApprovalProps) {
  const { t } = useTranslation();

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-2">
        {t("agent.planProposal")}
      </p>
      <pre className="text-sm whitespace-pre-wrap mb-3">{plan}</pre>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onReject} className="gap-1.5">
          <X className="size-3.5" />
          {t("agent.reject")}
        </Button>
        <Button size="sm" onClick={onApprove} className="gap-1.5">
          <Check className="size-3.5" />
          {t("agent.approve")}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/board/StreamMessage.tsx frontend/src/components/board/PlanApproval.tsx
git commit -m "feat(frontend): add StreamMessage and PlanApproval components"
```

---

## Task 13: Upgrade SessionsPanel with live streaming

**Files:**
- Modify: `frontend/src/components/board/SessionsPanel.tsx`

- [ ] **Step 1: Add streaming to running sessions**

In `SessionsPanel`, update session partitioning and rendering for live streaming.

Key changes:
- Define an `ACTIVE_STATUSES` constant and update the session filter:
  ```typescript
  const ACTIVE_STATUSES = ['running', 'planning', 'awaiting_approval', 'executing'];
  const isActive = (s: AgentSession) => ACTIVE_STATUSES.includes(s.status);
  const runningSessions = sessions.filter(isActive);
  const completedSessions = sessions.filter((s) => !isActive(s));
  const hasRunning = sessions.some(isActive); // used for 3s polling interval
  ```
- Import `useSessionStream`, `StreamMessage`, `PlanApproval`
- For the expanded running session, render `messages.map(m => <StreamMessage />)` instead of `<pre>{session.log}</pre>`
- When `status === "awaiting_approval"`, find the plan message and render `<PlanApproval>` with `approve()`/`reject()` callbacks
- Auto-scroll to bottom on new messages using a `ref` + `scrollIntoView`
- Keep the existing static log display for completed sessions (status: success/failed/cancelled)
- Update cancel button to show for all active statuses: `isActive(session) && onCancel`

- [ ] **Step 2: Verify in browser**

Run: `make dev` (backend + frontend)
Navigate to a board → open a task → check SessionsPanel renders

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/board/SessionsPanel.tsx
git commit -m "feat(frontend): upgrade SessionsPanel with live streaming"
```

---

## Task 14: Upgrade SessionsView and SessionCard with live streaming

**Files:**
- Modify: `frontend/src/components/board/SessionsView.tsx`

- [ ] **Step 1: Add streaming to SessionCard**

Same pattern as Task 13 but in the `SessionCard` component within `SessionsView.tsx`:
- **Update session partitioning:** Use the same `ACTIVE_STATUSES` / `isActive` pattern from Task 13 to fix `runningSessions`, `completedSessions`, and `hasRunning` (used for polling)
- For running/planning/executing sessions: render live stream messages
- For awaiting_approval: show PlanApproval inline
- For completed: keep static log
- Update the Badge to use new status values
- **Update cancel button:** Change `session.status === 'running' && onCancel` to `isActive(session) && onCancel` (where `isActive` checks for `running`, `planning`, `awaiting_approval`, `executing`)

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/board/SessionsView.tsx
git commit -m "feat(frontend): upgrade SessionsView with live streaming"
```

---

## Task 15: Update SessionIndicator and BoardSessionsPanel

**Files:**
- Modify: `frontend/src/components/board/SessionIndicator.tsx`
- Modify: `frontend/src/components/board/BoardSessionsPanel.tsx`

- [ ] **Step 1: Update SessionIndicator**

Add visual states for `planning` (blue pulse), `awaiting_approval` (amber pulse), `executing` (green pulse). Currently only handles: running, success, failed, cancelled.

- [ ] **Step 2: Update BoardSessionsPanel**

Update the status Badge rendering to use the new `SESSION_STATUS_COLORS` entries. No streaming needed here — this is a summary view. Also:
- Update session partition filter (`runningSessions`/`completedSessions`) to use `ACTIVE_STATUSES` pattern from Task 13
- Update cancel button condition to include all active statuses (same pattern: `isActive(session) && onCancel`)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/board/SessionIndicator.tsx frontend/src/components/board/BoardSessionsPanel.tsx
git commit -m "feat(frontend): update session indicators for new statuses"
```

---

## Task 16: Add i18n translation keys

**Files:**
- Modify: `frontend/src/i18n/locales/en.json`
- Modify: `frontend/src/i18n/locales/fr.json`

- [ ] **Step 1: Add English translations**

```json
{
  "agent": {
    "planProposal": "Proposed Plan",
    "approve": "Approve",
    "reject": "Reject",
    "planning": "Planning...",
    "awaitingApproval": "Awaiting approval",
    "executing": "Executing...",
    "streamDisconnected": "Disconnected from agent"
  }
}
```

- [ ] **Step 2: Add French translations**

```json
{
  "agent": {
    "planProposal": "Plan propos\u00e9",
    "approve": "Approuver",
    "reject": "Rejeter",
    "planning": "Planification...",
    "awaitingApproval": "En attente d'approbation",
    "executing": "Ex\u00e9cution...",
    "streamDisconnected": "D\u00e9connect\u00e9 de l'agent"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/i18n/locales/en.json frontend/src/i18n/locales/fr.json
git commit -m "feat(i18n): add agent streaming translation keys"
```

---

## Task 17: Rust cleanup — remove agent modules

**Files:**
- Delete: `crates/tarmak/src/agent/pty.rs`
- Delete: `crates/tarmak/src/agent/server.rs`
- Delete: `crates/tarmak/src/agent/worktree.rs`
- Delete: `crates/tarmak/src/agent/repo_cache.rs`
- Delete: `crates/tarmak/src/agent/token.rs`
- Delete: `crates/tarmak/src/agent/detect.rs`
- Modify: `crates/tarmak/src/agent/mod.rs`
- Modify: `crates/tarmak/src/main.rs`

- [ ] **Step 1: Gut agent/mod.rs**

Replace with a minimal module that just provides a function to launch the Node server:

```rust
use std::process::Command;
use anyhow::Result;

pub fn launch_agent_server(server: &str, token: &str, port: u16, origins: &[String]) -> Result<()> {
    let origins_str = origins.join(",");
    let status = Command::new("npx")
        .arg("tsx")
        .arg("agent/src/index.ts")
        .arg("--server").arg(server)
        .arg("--token").arg(token)
        .arg("--port").arg(port.to_string())
        .arg("--allowed-origins").arg(&origins_str)
        .status()?;
    if !status.success() {
        anyhow::bail!("Agent server exited with code {:?}", status.code());
    }
    Ok(())
}
```

- [ ] **Step 2: Update main.rs Agent command**

Replace the `run_agent_server` call with `launch_agent_server`.

- [ ] **Step 3: Delete old module files**

```bash
rm crates/tarmak/src/agent/pty.rs
rm crates/tarmak/src/agent/server.rs
rm crates/tarmak/src/agent/worktree.rs
rm crates/tarmak/src/agent/repo_cache.rs
rm crates/tarmak/src/agent/token.rs
rm crates/tarmak/src/agent/detect.rs
```

- [ ] **Step 4: Remove unused Rust dependencies from Cargo.toml**

Check if `which`, `hex`, and other agent-only deps can be removed. Only remove deps not used elsewhere.

- [ ] **Step 5: Verify Rust compiles**

Run: `cargo build --workspace`
Expected: Compiles without errors

- [ ] **Step 6: Commit**

```bash
git add -A crates/tarmak/src/agent/ crates/tarmak/src/main.rs crates/tarmak/Cargo.toml
git commit -m "refactor: remove Rust agent modules, delegate to TypeScript server"
```

---

## Task 18: Update Makefile

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Update make agent target**

```makefile
## agent: Agent server (port 9876, auto-login)
agent:
	@cd agent && npm install --silent
	@TOKEN=$$(curl -sf http://localhost:4000/api/v1/auth/login \
		-H 'Content-Type: application/json' \
		-d '{"email":"$(TARMAK_EMAIL)","password":"$(TARMAK_PASSWORD)"}' \
		| python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null) && \
	if [ -z "$$TOKEN" ]; then echo "Warning: could not auto-login for agent (set TARMAK_EMAIL and TARMAK_PASSWORD)"; exit 0; fi && \
	cd agent && npx tsx src/index.ts --server http://localhost:4000 --token "$$TOKEN"
```

- [ ] **Step 2: Add install target for agent**

```makefile
## install: Install all dependencies
install:
	cd frontend && corepack pnpm install
	cd agent && npm install
```

- [ ] **Step 3: Update make dev to start all 3 servers**

Ensure `make dev` starts backend (4000) + agent (9876) + frontend (3000).

- [ ] **Step 4: Update make clean and make kill**

Add `agent/` cleanup to `make clean`:
```makefile
clean:
	# ... existing cleanup ...
	rm -rf agent/node_modules agent/dist
```

Add agent process kill to `make kill`:
```makefile
kill:
	# ... existing kills ...
	-pkill -f "tsx.*agent/src/index" 2>/dev/null || true
```

- [ ] **Step 5: Verify**

Run: `make agent`
Expected: Agent server starts on port 9876

- [ ] **Step 6: Commit**

```bash
git add Makefile
git commit -m "build: update Makefile for TypeScript agent server"
```

---

## Task 19: Integration test — full run cycle

No new test files — manual verification.

- [ ] **Step 1: Start all servers**

Run: `make dev` (or `make back`, `make agent`, `make front` in 3 terminals)

- [ ] **Step 2: Verify health endpoint**

Run: `curl http://localhost:9876/health`
Expected: `{ "status": "ok", "version": "0.1.0", ... }`

- [ ] **Step 3: Verify config endpoint**

Run: `curl -H "Authorization: Bearer $(cat ~/.tarmak/agent-token)" http://localhost:9876/config`
Expected: JSON with global settings, skills, projects

- [ ] **Step 4: Test full session via UI**

1. Open Tarmak in browser (`http://localhost:3000`)
2. Open a board with a `repo_url` configured
3. Create or open a task with a description
4. Click "Run"
5. Verify: SessionsPanel shows planning phase with live streaming
6. Verify: Plan appears with Approve/Reject buttons
7. Click "Approve"
8. Verify: Execution phase streams live
9. Verify: Session completes with status "success"
10. Verify: Log is persisted in the Tarmak DB (visible after refresh)

- [ ] **Step 5: Test cancel**

1. Start a session
2. Click cancel during planning or executing phase
3. Verify: Session shows "cancelled" status

- [ ] **Step 6: Test reject plan**

1. Start a session
2. Wait for plan to appear
3. Click "Reject"
4. Verify: Session shows "cancelled" status, no code changes made

- [ ] **Step 7: Commit any fixes from integration testing**

```bash
git add -A
git commit -m "fix: integration test fixes for agent SDK migration"
```
