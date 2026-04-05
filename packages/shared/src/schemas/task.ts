import { z } from "zod";

const prioritySchema = z.enum(["low", "medium", "high", "urgent"]);

export const createTaskSchema = z.object({
  board_id: z.string().uuid(),
  column_id: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().max(50000).nullable().optional(),
  priority: prioritySchema.default("medium"),
  assignee: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(50000).nullable().optional(),
  priority: prioritySchema.optional(),
  assignee: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
});

export const moveTaskSchema = z.object({
  task_id: z.string().uuid(),
  column_id: z.string().uuid(),
  position: z.number().int().min(0),
});
