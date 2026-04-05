import crypto from "node:crypto";
import type { DB } from "@tarmak/db";
import { sessions, users } from "@tarmak/db";
import { and, eq, gt } from "drizzle-orm";

export function resolveUser(db: DB, authHeader: string | undefined) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const session = db
    .select()
    .from(sessions)
    .where(
      and(eq(sessions.token_hash, tokenHash), gt(sessions.expires_at, new Date().toISOString())),
    )
    .get();
  if (!session) return null;

  const user = db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, session.user_id))
    .get();
  return user ?? null;
}
