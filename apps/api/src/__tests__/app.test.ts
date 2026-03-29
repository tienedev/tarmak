import { describe, expect, it } from "vitest";
import { createApp } from "../app";

describe("app", () => {
  it("responds to health check", async () => {
    const { app } = createApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("sets security headers", async () => {
    const { app } = createApp();
    const res = await app.request("/health");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });
});
