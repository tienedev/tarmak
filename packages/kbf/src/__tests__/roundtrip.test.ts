import { describe, expect, it } from "vitest";
import { decodeDeltas, decodeFull } from "../decode";
import { encodeDelta, encodeFull } from "../encode";
import { Schema } from "../schema";

describe("roundtrip", () => {
  it("full encode → decode", () => {
    const schema = new Schema("task", ["id", "title", "status"]);
    const rows = [
      ["t1", "Build UI", "doing"],
      ["t2", "Write tests", "todo"],
    ];
    const decoded = decodeFull(encodeFull(schema, rows));
    expect(decoded.schema).toEqual(schema);
    expect(decoded.rows).toEqual(rows);
  });

  it("full with pipes", () => {
    const schema = new Schema("task", ["id", "title"]);
    const rows = [["t1", "A|B|C"]];
    const decoded = decodeFull(encodeFull(schema, rows));
    expect(decoded.rows).toEqual(rows);
  });

  it("delta encode → decode", () => {
    const deltas = [
      { type: "update" as const, id: "t1", field: "status", value: "done" },
      { type: "create" as const, row: ["t3", "New", "todo"] },
      { type: "delete" as const, id: "t2" },
    ];
    expect(decodeDeltas(encodeDelta(deltas))).toEqual(deltas);
  });
});
