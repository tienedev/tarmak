import { describe, expect, it } from "vitest";
import { createTaskSchema } from "../schemas/task";
import { loginSchema, registerSchema } from "../schemas/user";
import { createBoardSchema } from "../schemas/board";

describe("createTaskSchema", () => {
  it("accepts valid task", () => {
    const result = createTaskSchema.safeParse({
      board_id: "550e8400-e29b-41d4-a716-446655440000",
      column_id: "550e8400-e29b-41d4-a716-446655440001",
      title: "Fix bug",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = createTaskSchema.safeParse({
      board_id: "550e8400-e29b-41d4-a716-446655440000",
      column_id: "550e8400-e29b-41d4-a716-446655440001",
      title: "",
    });
    expect(result.success).toBe(false);
  });

  it("defaults priority to medium", () => {
    const result = createTaskSchema.parse({
      board_id: "550e8400-e29b-41d4-a716-446655440000",
      column_id: "550e8400-e29b-41d4-a716-446655440001",
      title: "Task",
    });
    expect(result.priority).toBe("medium");
  });
});

describe("loginSchema", () => {
  it("rejects short password", () => {
    const result = loginSchema.safeParse({ email: "a@b.com", password: "short" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = loginSchema.safeParse({ email: "not-email", password: "12345678" });
    expect(result.success).toBe(false);
  });
});

describe("createBoardSchema", () => {
  it("accepts valid board", () => {
    const result = createBoardSchema.safeParse({ name: "My Board" });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createBoardSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });
});
