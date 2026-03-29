import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { logger } from "./logger";

const port = Number(process.env.PORT ?? 4000);
const dbPath = process.env.DATABASE_PATH ?? "./tarmak.db";

const { app } = createApp(dbPath);

logger.info(`tarmak api listening on port ${port}`);
serve({ fetch: app.fetch, port });
