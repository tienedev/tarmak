import { Hono } from "hono";
import { cors } from "hono/cors";
import { securityHeaders } from "./middleware/security";
import { rateLimit } from "./middleware/rate-limit";
import { createDb, migrateDb, type DB } from "@tarmak/db";

export function createApp(dbPath?: string): { app: Hono; db: DB } {
  const db = createDb(dbPath);
  migrateDb(db);

  const app = new Hono();

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

  return { app, db };
}
