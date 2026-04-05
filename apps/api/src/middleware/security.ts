import { createMiddleware } from "hono/factory";

export function securityHeaders() {
  return createMiddleware(async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains",
    );
    c.header(
      "Content-Security-Policy",
      process.env.TARMAK_CSP ??
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
    );
  });
}
