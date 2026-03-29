import { Hono } from "hono";
import { cors } from "hono/cors";
import { securityHeaders } from "./middleware/security";
import { rateLimit } from "./middleware/rate-limit";
import { createDb, migrateDb, type DB } from "@tarmak/db";
import { NotificationBroadcaster } from "./notifications/broadcaster";
import { TicketStore } from "./notifications/ticket-store";

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

  // Create a short-lived ticket for SSE stream (must be called by authenticated user)
  app.post("/api/notifications/stream/ticket", (c) => {
    const userId = c.req.query("userId");
    if (!userId) {
      return c.json({ error: "userId required" }, 400);
    }
    const ticket = ticketStore.create(userId);
    return c.json({ ticket });
  });

  // SSE endpoint for notifications (ticket-based auth)
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

          // Send connected confirmation
          controller.enqueue(
            encoder.encode("event: connected\ndata: {}\n\n"),
          );

          const unsubscribe = broadcaster.subscribe(userId, (event) => {
            controller.enqueue(
              encoder.encode(
                `event: notification\ndata: ${JSON.stringify(event)}\n\n`,
              ),
            );
          });

          // Keep-alive ping every 30 seconds
          const keepAlive = setInterval(() => {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          }, 30_000);

          // Cleanup on client disconnect
          c.req.raw.signal.addEventListener("abort", () => {
            unsubscribe();
            clearInterval(keepAlive);
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
