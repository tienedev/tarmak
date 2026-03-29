import { createMiddleware } from "hono/factory";

const MAX_ENTRIES = 10_000;

export function rateLimit(opts: { max: number; windowMs: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return createMiddleware(async (c, next) => {
    const key =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "direct";
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now > entry.resetAt) {
      // Prune expired entries when map grows too large
      if (hits.size > MAX_ENTRIES) {
        for (const [k, v] of hits) {
          if (now > v.resetAt) hits.delete(k);
        }
      }
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
    } else {
      entry.count++;
      if (entry.count > opts.max) {
        return c.json({ error: "Too many requests" }, 429);
      }
    }

    await next();
  });
}
