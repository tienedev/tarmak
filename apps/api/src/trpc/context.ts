import { initTRPC } from "@trpc/server";
import type { DB } from "@tarmak/db";

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
