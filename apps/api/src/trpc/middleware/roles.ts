import { TRPCError } from "@trpc/server";
import { middleware } from "../context";
import { ROLE_HIERARCHY } from "@tarmak/shared";
import type { Role } from "@tarmak/shared";
import { boardsRepo } from "@tarmak/db";

export function requireRole(minimumRole: Role) {
  return middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });

    // Extract boardId from input — procedures must include boardId
    const rawInput = await ("getRawInput" in opts
      ? (opts as { getRawInput: () => Promise<unknown> }).getRawInput()
      : (opts as { rawInput: unknown }).rawInput);
    const input = rawInput as { boardId?: string } | undefined;
    const boardId = input?.boardId;
    if (!boardId) throw new TRPCError({ code: "BAD_REQUEST", message: "boardId required" });

    const role = boardsRepo.getMemberRole(ctx.db, boardId, ctx.user.id);
    if (!role) throw new TRPCError({ code: "FORBIDDEN", message: "Not a board member" });

    const userLevel = ROLE_HIERARCHY[role] ?? 0;
    const requiredLevel = ROLE_HIERARCHY[minimumRole] ?? 0;
    if (userLevel < requiredLevel) {
      throw new TRPCError({ code: "FORBIDDEN", message: `Requires ${minimumRole} role` });
    }

    return next({ ctx: { ...ctx, boardRole: role as Role } });
  });
}
