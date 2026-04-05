import crypto from "node:crypto";
import type { DB } from "@tarmak/db";
import { apiKeys } from "@tarmak/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { resolveUser } from "../auth/resolve-user";
import type { AuthEnv } from "./types";

const createKeySchema = z.object({
  name: z.string().min(1).max(100),
});

export function apiKeyRoutes(db: DB) {
  const app = new Hono<AuthEnv>();

  // Auth middleware for all routes
  app.use("*", async (c, next) => {
    const user = resolveUser(db, c.req.header("Authorization"));
    if (!user) {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("user", user);
    await next();
  });

  // GET / — list user's API keys
  app.get("/", (c) => {
    const user = c.get("user");
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
    const user = c.get("user");
    const parsed = createKeySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
    }
    const { name } = parsed.data;

    const rawKey = `tarmak_${crypto.randomBytes(32).toString("hex")}`;
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.slice(0, 12);
    const id = crypto.randomUUID();

    db.insert(apiKeys)
      .values({
        id,
        user_id: user.id,
        name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
      })
      .run();

    const apiKey = {
      id,
      user_id: user.id,
      name,
      key_prefix: keyPrefix,
      created_at: new Date().toISOString(),
      last_used_at: null,
    };

    return c.json({ key: rawKey, api_key: apiKey }, 201);
  });

  // DELETE /:id — delete API key
  app.delete("/:id", (c) => {
    const user = c.get("user");
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
