import crypto from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { DB } from "@tarmak/db";
import { apiKeys } from "@tarmak/db";
import { resolveUser } from "../auth/resolve-user";

export function apiKeyRoutes(db: DB) {
  const app = new Hono();

  // Auth middleware for all routes
  app.use("*", async (c, next) => {
    const user = resolveUser(db, c.req.header("Authorization"));
    if (!user) {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("user" as never, user as never);
    await next();
  });

  // GET / — list user's API keys
  app.get("/", (c) => {
    const user = c.get("user" as never) as { id: string; name: string; email: string };
    const keys = db
      .select({
        id: apiKeys.id,
        user_id: apiKeys.user_id,
        name: apiKeys.name,
        key_prefix: apiKeys.key_prefix,
        created_at: apiKeys.created_at,
        last_used_at: apiKeys.last_used_at,
      })
      .from(apiKeys)
      .where(eq(apiKeys.user_id, user.id))
      .all();
    return c.json(keys);
  });

  // POST / — create API key
  app.post("/", async (c) => {
    const user = c.get("user" as never) as { id: string; name: string; email: string };
    const body = await c.req.json<{ name?: string }>();

    if (!body.name) {
      return c.json({ error: "name is required" }, 400);
    }

    const rawKey = `tarmak_${crypto.randomBytes(32).toString("hex")}`;
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.slice(0, 12);
    const id = crypto.randomUUID();

    db.insert(apiKeys)
      .values({
        id,
        user_id: user.id,
        name: body.name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
      })
      .run();

    const apiKey = {
      id,
      user_id: user.id,
      name: body.name,
      key_prefix: keyPrefix,
      created_at: new Date().toISOString(),
      last_used_at: null,
    };

    return c.json({ key: rawKey, api_key: apiKey }, 201);
  });

  // DELETE /:id — delete API key
  app.delete("/:id", (c) => {
    const user = c.get("user" as never) as { id: string; name: string; email: string };
    const id = c.req.param("id");

    const key = db
      .select({ id: apiKeys.id, user_id: apiKeys.user_id })
      .from(apiKeys)
      .where(eq(apiKeys.id, id))
      .get();

    if (!key || key.user_id !== user.id) {
      return c.json({ error: "not found" }, 404);
    }

    db.delete(apiKeys).where(eq(apiKeys.id, id)).run();
    return c.json({ ok: true });
  });

  return app;
}
