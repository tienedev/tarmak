import crypto from "node:crypto";
import type { DB } from "@tarmak/db";
import { boardMembers, boardsRepo, inviteLinks } from "@tarmak/db";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { resolveUser } from "../auth/resolve-user";
import type { AuthEnv } from "./types";

const createInviteSchema = z.object({
  board_id: z.string().min(1),
  role: z.enum(["owner", "member", "viewer"]).default("member"),
});

const acceptInviteSchema = z.object({
  invite_token: z.string().min(1),
});

export function inviteRoutes(db: DB) {
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

  // POST /invite — create invite link (owner only)
  app.post("/invite", async (c) => {
    const user = c.get("user");
    const parsed = createInviteSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
    }
    const { board_id, role } = parsed.data;

    // Only board owners can create invites
    const memberRole = boardsRepo.getMemberRole(db, board_id, user.id);
    if (memberRole !== "owner") {
      return c.json({ error: "Only board owners can create invites" }, 403);
    }

    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString("hex");
    const inviteDays = Number(process.env.TARMAK_INVITE_DAYS ?? 7);
    const expiresAt = new Date(Date.now() + inviteDays * 24 * 60 * 60 * 1000).toISOString();

    db.insert(inviteLinks)
      .values({
        id,
        board_id,
        token,
        role,
        expires_at: expiresAt,
        created_by: user.id,
      })
      .run();

    return c.json({ invite_url: `/invite/${token}` }, 201);
  });

  // GET /invite?board_id=X — list invites for a board (members only)
  app.get("/invite", (c) => {
    const user = c.get("user");
    const boardId = c.req.query("board_id");
    if (!boardId) {
      return c.json({ error: "board_id query param is required" }, 400);
    }

    // Only board members can list invites
    const memberRole = boardsRepo.getMemberRole(db, boardId, user.id);
    if (!memberRole) {
      return c.json({ error: "Not a board member" }, 403);
    }

    const invites = db.select().from(inviteLinks).where(eq(inviteLinks.board_id, boardId)).all();

    return c.json(invites);
  });

  // DELETE /invite/:id — revoke invite (owner only)
  app.delete("/invite/:id", (c) => {
    const user = c.get("user");
    const id = c.req.param("id");

    const invite = db.select().from(inviteLinks).where(eq(inviteLinks.id, id)).get();

    if (!invite) {
      return c.json({ error: "not found" }, 404);
    }

    // Only board owners can revoke invites
    const memberRole = boardsRepo.getMemberRole(db, invite.board_id, user.id);
    if (memberRole !== "owner") {
      return c.json({ error: "Only board owners can revoke invites" }, 403);
    }

    db.delete(inviteLinks).where(eq(inviteLinks.id, id)).run();
    return c.json({ ok: true });
  });

  // POST /accept — accept invite by token
  app.post("/accept", async (c) => {
    const user = c.get("user");
    const parsed = acceptInviteSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
    }
    const { invite_token } = parsed.data;

    const invite = db.select().from(inviteLinks).where(eq(inviteLinks.token, invite_token)).get();

    if (!invite) {
      return c.json({ error: "invalid or expired invite" }, 404);
    }

    // Check expiry
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return c.json({ error: "invite has expired" }, 410);
    }

    // Check if already a member
    const existing = db
      .select({ board_id: boardMembers.board_id })
      .from(boardMembers)
      .where(and(eq(boardMembers.board_id, invite.board_id), eq(boardMembers.user_id, user.id)))
      .get();

    if (!existing) {
      db.insert(boardMembers)
        .values({
          board_id: invite.board_id,
          user_id: user.id,
          role: invite.role,
        })
        .run();
    }

    return c.json({ ok: true });
  });

  return app;
}
