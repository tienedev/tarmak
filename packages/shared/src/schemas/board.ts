import { z } from "zod";

export const createBoardSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).nullable().optional(),
  repo_url: z.string().url().nullable().optional(),
});

export const updateBoardSchema = createBoardSchema.partial();

export const createColumnSchema = z.object({
  board_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  wip_limit: z.number().int().positive().nullable().optional(),
  color: z.string().max(7).nullable().optional(),
});

export const moveColumnSchema = z.object({
  column_id: z.string().uuid(),
  position: z.number().int().min(0),
});
