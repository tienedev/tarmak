import crypto from "node:crypto";
import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import type { DB } from "@tarmak/db";
import { inviteLinks, boardMembers } from "@tarmak/db";
import { resolveUser } from "../auth/resolve-user";

export function inviteRoutes(db: DB) {
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

  // POST /invite — create invite link
  app.post("/invite", async (c) => {
    const user = c.get("user" as never) as { id: string; name: string; email: string };
    const body = await c.req.json<{ board_id?: string; role?: string }>();

    if (!body.board_id) {
      return c.json({ error: "board_id is required" }, 400);
    }

    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString("hex");
    const role = body.role ?? "member";
    const inviteDays = Number(process.env.TARMAK_INVITE_DAYS ?? 7);
    const expiresAt = new Date(Date.now() + inviteDays * 24 * 60 * 60 * 1000).toISOString();

    db.insert(inviteLinks)
      .values({
        id,
        board_id: body.board_id,
        token,
        role,
        expires_at: expiresAt,
        created_by: user.id,
      })
      .run();

    return c.json({ invite_url: `/invite/${token}` }, 201);
  });

  // GET /invite?board_id=X — list invites for a board
  app.get("/invite", (c) => {
    const boardId = c.req.query("board_id");
    if (!boardId) {
      return c.json({ error: "board_id query param is required" }, 400);
    }

    const invites = db
      .select()
      .from(inviteLinks)
      .where(eq(inviteLinks.board_id, boardId))
      .all();

    return c.json(invites);
  });

  // DELETE /invite/:id — revoke invite
  app.delete("/invite/:id", (c) => {
    const id = c.req.param("id");

    const invite = db
      .select({ id: inviteLinks.id })
      .from(inviteLinks)
      .where(eq(inviteLinks.id, id))
      .get();

    if (!invite) {
      return c.json({ error: "not found" }, 404);
    }

    db.delete(inviteLinks).where(eq(inviteLinks.id, id)).run();
    return c.json({ ok: true });
  });

  // POST /accept — accept invite by token
  app.post("/accept", async (c) => {
    const user = c.get("user" as never) as { id: string; name: string; email: string };
    const body = await c.req.json<{ invite_token?: string }>();

    if (!body.invite_token) {
      return c.json({ error: "invite_token is required" }, 400);
    }

    const invite = db
      .select()
      .from(inviteLinks)
      .where(eq(inviteLinks.token, body.invite_token))
      .get();

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
      .where(
        and(
          eq(boardMembers.board_id, invite.board_id),
          eq(boardMembers.user_id, user.id),
        ),
      )
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
