import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { DB } from "@tarmak/db";

// Better Auth is used ONLY for authentication (email/password + sessions).
// Plugins intentionally omitted:
// - organization(): manages global orgs, not per-board membership. Tarmak uses
//   a custom board_members table for board-level roles (owner/member/viewer).
// - apiKey(): will be added if needed; current Tarmak API keys use a custom table.
// - invitation(): board invites use a custom invite_links table.
//
// Better Auth creates its own tables (user, session, account, verification)
// which are separate from Tarmak's existing users/sessions tables. The two
// systems will be reconciled during the data migration phase (Task 21).

export function createAuth(db: DB) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
    }),
    emailAndPassword: { enabled: true },
    session: {
      expiresIn: Number(process.env.TARMAK_SESSION_DAYS ?? 30) * 24 * 60 * 60,
    },
  });
}
