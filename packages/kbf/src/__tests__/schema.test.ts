import { describe, expect, it } from "vitest";
import { Schema } from "../schema";

describe("Schema", () => {
  it("encodes to header format", () => {
    const schema = new Schema("task", ["id", "title", "status", "pri", "who"]);
    expect(schema.encode()).toBe("#task@v1:id,title,status,pri,who");
  });

  it("encodes with custom version", () => {
    const schema = new Schema("task", ["id", "title"], 3);
    expect(schema.encode()).toBe("#task@v3:id,title");
  });

  it("parses valid header", () => {
    const schema = Schema.parse("#task@v1:id,title,status");
    expect(schema).not.toBeNull();
    expect(schema!.entity).toBe("task");
    expect(schema!.version).toBe(1);
    expect(schema!.fields).toEqual(["id", "title", "status"]);
  });

  it("returns null for missing #", () => {
    expect(Schema.parse("task@v1:id,title")).toBeNull();
  });

  it("returns null for empty fields", () => {
    expect(Schema.parse("#task@v1:")).toBeNull();
  });

  it("finds field index", () => {
    const schema = new Schema("task", ["id", "title", "status"]);
    expect(schema.fieldIndex("title")).toBe(1);
    expect(schema.fieldIndex("missing")).toBe(-1);
  });

  it("roundtrips encode/parse", () => {
    const original = new Schema("board", ["id", "name", "cols"], 2);
    const parsed = Schema.parse(original.encode());
    expect(parsed).toEqual(original);
  });
});
