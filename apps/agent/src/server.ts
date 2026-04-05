import fs from "node:fs";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { serve } from "@hono/node-server";
// agent/src/server.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { v4 as uuidv4 } from "uuid";
import { type WebSocket, WebSocketServer } from "ws";

import { reportSessionCompleted, reportSessionCreated } from "./callback.js";
import { getConfig } from "./config.js";
import { detectRepos } from "./detect.js";
import { RepoCache } from "./repo-cache.js";
import { sendMessage, transformMessageAll } from "./sdk.js";
import { generateToken, loadToken, saveToken } from "./token.js";
import type {
  HealthResponse,
  RunRequest,
  RunResponse,
  ServerMessage,
  Session,
  SessionInfo,
} from "./types.js";
import {
  branchName,
  cleanupOrphanedWorktrees,
  cleanupWorktree,
  createWorktree,
} from "./worktree.js";

interface StartOptions {
  serverUrl: string;
  serverToken: string;
  port: number;
  allowedOrigins: string[];
}

const SDK_OPTIONS = {
  allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  maxTurns: 50,
  maxBudgetUsd: 5,
  settingSources: ["project"] as ["project"],
};

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_SESSION_MESSAGES = 500;

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
  const approvalResolvers = new Map<string, (msg: { type: string }) => void>(); // sessionId → resolver

  // Cleanup orphaned worktrees from previous crashes
  for (const [, workdir] of repoCache.entries()) {
    await cleanupOrphanedWorktrees(workdir);
  }

  // --- Auth helpers ---
  async function validateToken(token: string): Promise<boolean> {
    if (!token) return false;
    // Fast path: known tokens
    if (token === agentToken || token === opts.serverToken) return true;
    // Cache check
    const now = Date.now();
    const cached = validatedTokens.get(token);
    if (cached && now - cached < TOKEN_TTL_MS) return true;
    // Prune stale entries periodically (keep cache bounded)
    if (validatedTokens.size > 100) {
      for (const [k, ts] of validatedTokens) {
        if (now - ts > TOKEN_TTL_MS) validatedTokens.delete(k);
      }
    }
    // HTTP validation
    try {
      const res = await fetch(`${opts.serverUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        validatedTokens.set(token, now);
        return true;
      }
    } catch {
      /* validation failed */
    }
    return false;
  }

  function extractToken(authHeader: string | undefined | null): string {
    if (!authHeader) return "";
    return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  }

  const app = new Hono();

  // CORS
  app.use("*", cors({ origin: opts.allowedOrigins }));

  // Auth middleware — skip health and WS routes
  app.use("*", async (c, next) => {
    if (c.req.path === "/health") return next();
    if (c.req.path.startsWith("/ws/")) return next(); // WS auth handled in WS handler

    const token = extractToken(c.req.header("authorization"));
    if (!(await validateToken(token))) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  });

  // --- GET /health ---
  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      version: "0.1.0",
      protocol_version: 2,
      sessions_active: sessions.size,
    } satisfies HealthResponse);
  });

  // --- GET /sessions ---
  app.get("/sessions", (c) => {
    const list: SessionInfo[] = [];
    for (const [id, s] of sessions) {
      list.push({
        session_id: id,
        board_id: s.boardId,
        task_id: s.taskId,
        status: s.status,
      });
    }
    return c.json(list);
  });

  // --- POST /run ---
  app.post("/run", async (c) => {
    const body = await c.req.json<RunRequest>();
    const { board_id, task_id, prompt, repo_url } = body ?? ({} as RunRequest);
    if (!board_id || !task_id || !prompt || !repo_url) {
      return c.json({ error: "Missing required fields: board_id, task_id, prompt, repo_url" }, 400);
    }

    // Resolve workdir
    let workdir = repoCache.get(repo_url);
    if (!workdir) {
      await detectRepos([repo_url], repoCache);
      workdir = repoCache.get(repo_url);
    }
    if (!workdir) {
      return c.json(
        {
          error: "Repository not found on this machine",
          hint: `Use POST /config/set-workdir to register the local path for ${repo_url}`,
        },
        400,
      );
    }

    const sessionId = uuidv4();
    const branch = branchName(task_id, sessionId);

    let worktreePath: string;
    try {
      worktreePath = await createWorktree(workdir, sessionId, branch);
    } catch (err) {
      return c.json(
        {
          error: `Failed to create worktree: ${err instanceof Error ? err.message : String(err)}`,
        },
        500,
      );
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
    reportSessionCreated(opts.serverUrl, opts.serverToken, session).catch(() => {});

    // Run session in background (don't await)
    runSession(session).catch((err) => {
      console.error(`Session ${sessionId} error:`, err);
      session.status = "failed";
      session.exitCode = 1;
      broadcastToSession(sessionId, { type: "error", message: String(err) });
      broadcastToSession(sessionId, { type: "status", status: "failed" });
    });

    const wsUrl = `ws://localhost:${opts.port}/ws/${sessionId}`;
    return c.json({
      session_id: sessionId,
      status: "running",
      branch_name: branch,
      ws_url: wsUrl,
    } satisfies RunResponse);
  });

  // --- POST /sessions/:id/cancel ---
  app.post("/sessions/:id/cancel", async (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    session.status = "cancelled";
    broadcastToSession(session.id, { type: "status", status: "cancelled" });
    return c.json({ status: "cancelled" });
  });

  // --- GET /config ---
  app.get("/config", (c) => {
    const workdirs = new Map<string, string>();
    for (const [url, dir] of repoCache.entries()) {
      workdirs.set(url, dir);
    }
    return c.json(getConfig(workdirs));
  });

  // --- POST /config/set-workdir ---
  app.post("/config/set-workdir", async (c) => {
    const { repo_url, workdir } = await c.req.json<{ repo_url: string; workdir: string }>();

    if (!workdir || typeof workdir !== "string") {
      return c.json({ error: "Missing required field: workdir" }, 400);
    }
    if (!path.isAbsolute(workdir)) {
      return c.json({ error: "workdir must be an absolute path" }, 400);
    }
    if (!fs.existsSync(workdir) || !fs.statSync(workdir).isDirectory()) {
      return c.json({ error: "workdir does not exist or is not a directory" }, 400);
    }
    if (!fs.existsSync(path.join(workdir, ".git"))) {
      return c.json({ error: "workdir is not a git repository (no .git found)" }, 400);
    }

    repoCache.set(repo_url, workdir);
    await repoCache.save();
    return c.json({ status: "ok" });
  });

  // --- Helpers ---
  function broadcastToSession(sessionId: string, msg: ServerMessage): void {
    const session = sessions.get(sessionId);
    if (session) {
      session.messages.push(msg);
      if (session.messages.length > MAX_SESSION_MESSAGES) {
        // Keep the first message (initial status) and the most recent messages
        session.messages = [
          // biome-ignore lint/style/noNonNullAssertion: array is guaranteed non-empty here
          session.messages[0]!,
          ...session.messages.slice(-MAX_SESSION_MESSAGES + 1),
        ];
      }
    }

    const clients = sessionWs.get(sessionId);
    if (!clients) return;
    for (const ws of clients) {
      sendMessage(ws, msg);
    }
  }

  async function runSession(session: Session): Promise<void> {
    try {
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
      if (!response || response.type === "reject" || (session.status as string) === "cancelled") {
        session.status = "cancelled";
        session.exitCode = 0;
        broadcastToSession(session.id, { type: "status", status: "cancelled" });
        return;
      }

      // --- Phase 2: Execute ---
      session.status = "executing";
      broadcastToSession(session.id, { type: "status", status: "executing" });

      const executionPrompt = planText
        ? `Execute the following approved plan exactly as specified:\n\n${planText}\n\nOriginal request: ${session.prompt}`
        : session.prompt;

      for await (const message of query({
        prompt: executionPrompt,
        options: {
          cwd: session.worktreePath,
          permissionMode: "acceptEdits",
          ...SDK_OPTIONS,
        },
      })) {
        if ((session.status as string) === "cancelled") return;
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
    } finally {
      await cleanupSession(session);
    }
  }

  function waitForApproval(sessionId: string): Promise<{ type: string } | null> {
    return new Promise((resolve) => {
      let resolved = false;
      const done = (result: { type: string } | null) => {
        if (resolved) return;
        resolved = true;
        clearInterval(cancelCheck);
        clearTimeout(timeoutId);
        approvalResolvers.delete(sessionId);
        resolve(result);
      };

      // Register resolver — any WS client sending approve/reject will trigger it
      approvalResolvers.set(sessionId, (msg) => done(msg));

      // Poll for cancellation
      const cancelCheck = setInterval(() => {
        const session = sessions.get(sessionId);
        if (session?.status === "cancelled") done(null);
      }, 500);

      // Timeout after 10 minutes
      const timeoutId = setTimeout(() => done(null), 600_000);
    });
  }

  async function cleanupSession(session: Session): Promise<void> {
    // Report to Tarmak main server
    await reportSessionCompleted(opts.serverUrl, opts.serverToken, session);

    // Schedule message buffer cleanup (keep for 5 min after completion)
    setTimeout(
      () => {
        sessions.delete(session.id);
        sessionWs.delete(session.id);
      },
      5 * 60 * 1000,
    );

    // Cleanup worktree
    try {
      // Find the repo dir (parent of .worktrees)
      const sep = `${path.sep}.worktrees${path.sep}`;
      const repoDir = session.worktreePath.split(sep)[0];
      await cleanupWorktree(repoDir, session.id, session.branchName);
    } catch {
      // best-effort
    }
  }

  // --- Start HTTP server ---
  const server = serve({ fetch: app.fetch, port: opts.port, hostname: "127.0.0.1" });

  // --- WebSocket server (attached to the same HTTP server) ---
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url ?? "", `http://127.0.0.1:${opts.port}`);
    const match = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (!match) {
      socket.destroy();
      return;
    }

    const sessionId = match[1];

    // Auth check
    const token =
      extractToken(request.headers.authorization) || url.searchParams.get("token") || "";
    if (!(await validateToken(token))) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      // Register WebSocket for broadcasts
      if (!sessionWs.has(sessionId)) sessionWs.set(sessionId, new Set());
      sessionWs.get(sessionId)?.add(ws);

      // Replay buffered messages
      for (const msg of session.messages) {
        sendMessage(ws, msg);
      }

      // Route incoming messages (approve/reject) to pending resolver
      ws.on("message", (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (
            (parsed.type === "approve" || parsed.type === "reject") &&
            approvalResolvers.has(sessionId)
          ) {
            // biome-ignore lint/style/noNonNullAssertion: checked by .has() above
            const resolver = approvalResolvers.get(sessionId)!;
            approvalResolvers.delete(sessionId);
            resolver(parsed);
          }
        } catch {
          /* ignore malformed */
        }
      });

      ws.on("close", () => {
        sessionWs.get(sessionId)?.delete(ws);
      });
    });
  });

  console.log(`Agent server listening on http://127.0.0.1:${opts.port}`);
  console.log(`Agent token: ${agentToken.slice(0, 8)}...`);
}
