import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import type { DB } from "@tarmak/db";
import { attachmentsRepo, boardsRepo } from "@tarmak/db";
import { resolveUser } from "../auth/resolve-user";
import type { AuthEnv } from "./types";

const UPLOAD_DIR = path.resolve("./uploads");
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:\0]/g, "_").replace(/\.\./g, "_");
}

export function attachmentRoutes(db: DB) {
  const app = new Hono<AuthEnv>();

  // Auth middleware
  app.use("*", async (c, next) => {
    const user = resolveUser(db, c.req.header("Authorization"));
    if (!user) {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("user", user);
    await next();
  });

  // POST / — upload attachment
  app.post("/", async (c) => {
    const user = c.get("user");

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

    // Check board membership (must be at least member, not viewer)
    const role = boardsRepo.getMemberRole(db, boardId, user.id);
    if (!role || role === "viewer") {
      return c.json({ error: "Requires member role to upload attachments" }, 403);
    }

    const formData = await c.req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return c.json({ error: "file is required" }, 400);
    }

    // Check file size before reading into memory
    if (file.size > MAX_FILE_SIZE) {
      return c.json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` }, 413);
    }

    const filename = sanitizeFilename(file.name);
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
