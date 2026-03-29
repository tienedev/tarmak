import { Hono } from "hono";
import { cors } from "hono/cors";
import { securityHeaders } from "./middleware/security";
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

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  return { app, db };
}
