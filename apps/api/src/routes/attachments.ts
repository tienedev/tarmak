import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import type { DB } from "@tarmak/db";
import { attachmentsRepo } from "@tarmak/db";
import { resolveUser } from "../auth/resolve-user";

const UPLOAD_DIR = path.resolve("./uploads");

export function attachmentRoutes(db: DB) {
  const app = new Hono();

  // Auth middleware
  app.use("*", async (c, next) => {
    const user = resolveUser(db, c.req.header("Authorization"));
    if (!user) {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("user" as never, user as never);
    await next();
  });

  // POST / — upload attachment
  app.post("/", async (c) => {
    const user = c.get("user" as never) as { id: string; name: string; email: string };

    // Extract route params from the original URL since they're defined on the parent router
    const url = new URL(c.req.url, "http://localhost");
    const match = url.pathname.match(
      /\/api\/v1\/boards\/([^/]+)\/tasks\/([^/]+)\/attachments/,
    );
    if (!match) {
      return c.json({ error: "invalid path" }, 400);
    }
    const boardId = match[1]!;
    const taskId = match[2]!;

    const formData = await c.req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return c.json({ error: "file is required" }, 400);
    }

    const filename = file.name;
    const mimeType = file.type || "application/octet-stream";
    const buffer = Buffer.from(await file.arrayBuffer());
    const sizeBytes = buffer.length;
    const storageKey = `${crypto.randomUUID()}_${filename}`;

    // Ensure upload directory exists
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    // Write file to disk
    fs.writeFileSync(path.join(UPLOAD_DIR, storageKey), buffer);

    // Create attachment record via repo
    const attachment = attachmentsRepo.createAttachment(db, {
      taskId,
      boardId,
      filename,
      mimeType,
      sizeBytes,
      storageKey,
      uploadedBy: user.id,
    });

    return c.json(attachment, 201);
  });

  return app;
}
