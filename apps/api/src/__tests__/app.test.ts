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

  it("SSE stream requires ticket", async () => {
    const { app } = createApp();
    const res = await app.request("/api/notifications/stream");
    expect(res.status).toBe(400);
  });

  it("SSE stream rejects invalid ticket", async () => {
    const { app } = createApp();
    const res = await app.request("/api/notifications/stream?ticket=bogus");
    expect(res.status).toBe(401);
  });

  it("SSE ticket endpoint creates valid ticket", async () => {
    const { app } = createApp();
    const ticketRes = await app.request(
      "/api/notifications/stream/ticket?userId=u1",
      { method: "POST" },
    );
    expect(ticketRes.status).toBe(200);
    const { ticket } = (await ticketRes.json()) as { ticket: string };
    expect(ticket).toBeTruthy();
  });
});
