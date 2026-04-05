import { describe, expect, it } from "vitest";
import { encodeFull, encodeDelta, rowFromMap } from "../encode";
import { Schema } from "../schema";

describe("encodeFull", () => {
  it("encodes schema + rows", () => {
    const schema = new Schema("task", ["id", "title", "status"]);
    const rows = [
      ["t1", "Design login", "doing"],
      ["t2", "Fix bug", "todo"],
    ];
    expect(encodeFull(schema, rows)).toBe(
      "#task@v1:id,title,status\nt1|Design login|doing\nt2|Fix bug|todo",
    );
  });

  it("escapes pipes in values", () => {
    const schema = new Schema("task", ["id", "title"]);
    const rows = [["t1", "A|B"]];
    expect(encodeFull(schema, rows)).toBe("#task@v1:id,title\nt1|A\\|B");
  });
});

describe("encodeDelta", () => {
  it("encodes update, create, delete", () => {
    const deltas = [
      { type: "update" as const, id: "t1", field: "status", value: "done" },
      { type: "create" as const, row: ["t3", "New task", "todo"] },
      { type: "delete" as const, id: "t2" },
    ];
    expect(encodeDelta(deltas)).toBe(">t1.status=done\n>t3|New task|todo+\n>t2-");
  });

  it("escapes pipes in update value", () => {
    const deltas = [{ type: "update" as const, id: "t1", field: "title", value: "X|Y" }];
    expect(encodeDelta(deltas)).toBe(">t1.title=X\\|Y");
  });
});

describe("rowFromMap", () => {
  it("builds row from map using schema order", () => {
    const schema = new Schema("task", ["id", "title", "status"]);
    const map = new Map([["id", "t1"], ["title", "Do stuff"]]);
    expect(rowFromMap(schema, map)).toEqual(["t1", "Do stuff", ""]);
  });
});
