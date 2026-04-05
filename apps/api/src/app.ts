import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { serveStatic } from "@hono/node-server/serve-static";
import { securityHeaders } from "./middleware/security";
import { rateLimit } from "./middleware/rate-limit";
import { createDb, migrateDb, type DB } from "@tarmak/db";
import { NotificationBroadcaster } from "./notifications/broadcaster";
import { TicketStore } from "./notifications/ticket-store";
import { setTicketStore } from "./trpc/procedures/notifications";
import { appRouter } from "./trpc/router";
import { resolveUser } from "./auth/resolve-user";
import { authRoutes } from "./routes/auth";
import { apiKeyRoutes } from "./routes/api-keys";
import { inviteRoutes } from "./routes/invites";
import { attachmentRoutes } from "./routes/attachments";

// Resolve the web dist path relative to this compiled file so it works
// regardless of where the process is started from.
const apiDistDir = path.dirname(fileURLToPath(import.meta.url));
const webDistDir = path.resolve(apiDistDir, "../../web/dist");
const webDistExists = fs.existsSync(webDistDir);

export function createApp(dbPath?: string): {
  app: Hono;
  db: DB;
  broadcaster: NotificationBroadcaster;
  ticketStore: TicketStore;
} {
  const db = createDb(dbPath);
  migrateDb(db);

  const app = new Hono();
  const broadcaster = new NotificationBroadcaster();
  const ticketStore = new TicketStore();

  // Wire ticket store into tRPC notification procedures
  setTicketStore(ticketStore);

  // CORS
  const origins = (
    process.env.TARMAK_ALLOWED_ORIGINS ?? "http://localhost:3000"
  ).split(",");
  app.use("*", cors({ origin: origins, credentials: true }));

  // Security headers
  app.use("*", securityHeaders());

  // Rate limiting on API routes
  app.use("/api/*", rateLimit({ max: 500, windowMs: 60_000 }));

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  // SSE endpoint for notifications (ticket-based auth via tRPC createStreamTicket)
  app.get("/api/notifications/stream", (c) => {
    const ticketId = c.req.query("ticket");
    if (!ticketId) {
      return c.json({ error: "ticket required" }, 400);
    }

    const userId = ticketStore.consume(ticketId);
    if (!userId) {
      return c.json({ error: "invalid or expired ticket" }, 401);
    }

    return c.body(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          let closed = false;

          // Send connected confirmation
          controller.enqueue(
            encoder.encode("event: connected\ndata: {}\n\n"),
          );

          const unsubscribe = broadcaster.subscribe(userId, (event) => {
            if (closed) return;
            try {
              controller.enqueue(
                encoder.encode(
                  `event: notification\ndata: ${JSON.stringify(event)}\n\n`,
                ),
              );
            } catch {
              // Stream already closed — ignore
            }
          });

          // Keep-alive ping every 30 seconds
          const keepAlive = setInterval(() => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(": keepalive\n\n"));
            } catch {
              // Stream already closed — ignore
            }
          }, 30_000);

          // Cleanup on client disconnect
          c.req.raw.signal.addEventListener("abort", () => {
            closed = true;
            unsubscribe();
            clearInterval(keepAlive);
            try {
              controller.close();
            } catch {
              // Already closed
            }
          });
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      },
    );
  });

  // tRPC handler
  app.use("/trpc/*", async (c) => {
    return fetchRequestHandler({
      endpoint: "/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext: () => {
        const user = resolveUser(db, c.req.header("Authorization"));
        return { db, user };
      },
    });
  });

  // REST auth routes
  app.route("/api/v1/auth", authRoutes(db));

  // REST API key routes
  app.route("/api/v1/api-keys", apiKeyRoutes(db));

  // REST invite routes (mounted at /api/v1/auth for invite + accept)
  app.route("/api/v1/auth", inviteRoutes(db));

  // REST attachment upload routes
  app.route(
    "/api/v1/boards/:boardId/tasks/:taskId/attachments",
    attachmentRoutes(db),
  );

  // Serve frontend static files (only when built)
  if (webDistExists) {
    const relRoot = path.relative(process.cwd(), webDistDir);
    app.use("*", serveStatic({ root: relRoot }));
    // SPA fallback: serve index.html for any unmatched route
    app.get("*", (c) => {
      return c.html(fs.readFileSync(path.join(webDistDir, "index.html"), "utf-8"));
    });
  }

  return { app, db, broadcaster, ticketStore };
}
