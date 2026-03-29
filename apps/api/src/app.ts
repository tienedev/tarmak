import { Hono } from "hono";
import { cors } from "hono/cors";
import { securityHeaders } from "./middleware/security";
import { rateLimit } from "./middleware/rate-limit";
import { createDb, migrateDb, type DB } from "@tarmak/db";
import { NotificationBroadcaster } from "./notifications/broadcaster";
import { TicketStore } from "./notifications/ticket-store";
import { setTicketStore } from "./trpc/procedures/notifications";

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
  app.use("/api/*", rateLimit({ max: 100, windowMs: 60_000 }));

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

  // WebSocket sync: mounted at /ws/:boardId via @hono/node-server/ws
  // See src/sync/ws.ts for the SyncServer implementation

  return { app, db, broadcaster, ticketStore };
}
