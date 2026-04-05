import { initTRPC } from "@trpc/server";
import type { DB as DrizzleDB } from "@tarmak/db";

// Re-alias DB to avoid tsup DTS failing to resolve drizzle schema internals
type DB = DrizzleDB;

export interface Context {
  db: DB;
  user: { id: string; name: string; email: string } | null;
}

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape }) {
    return { ...shape, data: { ...shape.data } };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;
