import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { startDeadlineChecker } from "./background/deadlines";
import { startSessionCleanup } from "./background/sessions";
import { logger } from "./logger";

const port = Number(process.env.PORT ?? 4000);
const dbPath = process.env.DATABASE_PATH ?? "./tarmak.db";

const { app, db, broadcaster } = createApp(dbPath);

// Start background jobs
const deadlineTimer = startDeadlineChecker(db, broadcaster);
const sessionTimer = startSessionCleanup(db);

logger.info(`tarmak api listening on port ${port}`);
serve({ fetch: app.fetch, port });

// Graceful shutdown
function shutdown() {
  clearInterval(deadlineTimer);
  clearInterval(sessionTimer);
  logger.info("Background jobs stopped");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
