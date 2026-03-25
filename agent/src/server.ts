// agent/src/server.ts
import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import path from "path";
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
  allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  maxTurns: 50,
  maxBudgetUsd: 5,
  settingSources: ["project"] as ["project"],
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
    const { board_id, task_id, prompt, repo_url } = request.body ?? {} as RunRequest;
    if (!board_id || !task_id || !prompt || !repo_url) {
      return reply.code(400).send({ error: "Missing required fields: board_id, task_id, prompt, repo_url" });
    }

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

      for await (const message of query({
        prompt: session.prompt,
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
        clearInterval(checkInterval);
        clearTimeout(timeoutId);
        resolve(result);
      };

      const checkInterval = setInterval(() => {
        const session = sessions.get(sessionId);
        if (session?.status === "cancelled") {
          done(null);
          return;
        }
        const c = sessionWs.get(sessionId);
        if (c && c.size > 0) {
          clearInterval(checkInterval);
          listenForApproval(sessionId, done);
        }
      }, 500);

      // Timeout after 10 minutes
      const timeoutId = setTimeout(() => done(null), 600_000);

      // If clients already connected, listen immediately
      const clients = sessionWs.get(sessionId);
      if (clients && clients.size > 0) {
        clearInterval(checkInterval);
        listenForApproval(sessionId, done);
      }
    });
  }

  function listenForApproval(sessionId: string, resolve: (msg: { type: string } | null) => void): void {
    const clients = sessionWs.get(sessionId);
    if (!clients) { resolve(null); return; }

    const handlers: Array<[WebSocket, (data: Buffer) => void]> = [];
    for (const ws of clients) {
      const handler = (data: Buffer) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === "approve" || parsed.type === "reject") {
            // Remove all handlers from all clients
            for (const [c, h] of handlers) c.off("message", h);
            resolve(parsed);
          }
        } catch { /* ignore */ }
      };
      handlers.push([ws, handler]);
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
      const sep = `${path.sep}.worktrees${path.sep}`;
      const repoDir = session.worktreePath.split(sep)[0];
      await cleanupWorktree(repoDir, session.id, session.branchName);
    } catch {
      // best-effort
    }
  }

  // --- Start ---
  await app.listen({ port: opts.port, host: "127.0.0.1" });
  console.log(`Agent server listening on http://127.0.0.1:${opts.port}`);
  console.log(`Agent token: ${agentToken.slice(0, 8)}...`);
}
