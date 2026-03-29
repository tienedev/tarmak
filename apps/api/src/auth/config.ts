import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { DB } from "@tarmak/db";

export function createAuth(db: DB) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
    }),
    emailAndPassword: { enabled: true },
    session: { expiresIn: 30 * 24 * 60 * 60 }, // 30 days
  });
}
