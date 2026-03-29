import { createMiddleware } from "hono/factory";

export function rateLimit(opts: { max: number; windowMs: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return createMiddleware(async (c, next) => {
    const key = c.req.header("x-forwarded-for") ?? "unknown";
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now > entry.resetAt) {
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
