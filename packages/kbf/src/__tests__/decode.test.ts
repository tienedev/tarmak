import { describe, expect, it } from "vitest";
import { decodeDeltas, decodeFull } from "../decode";

describe("decodeFull", () => {
  it("decodes schema + rows", () => {
    const input = "#task@v1:id,title,status\nt1|Design login|doing\nt2|Fix bug|todo";
    const decoded = decodeFull(input);
    expect(decoded.schema.entity).toBe("task");
    expect(decoded.rows).toHaveLength(2);
    expect(decoded.rows[0]).toEqual(["t1", "Design login", "doing"]);
  });

  it("handles escaped pipes", () => {
    const input = "#task@v1:id,title\nt1|A\\|B";
    const decoded = decodeFull(input);
    expect(decoded.rows[0]).toEqual(["t1", "A|B"]);
  });

  it("pads short rows", () => {
    const input = "#task@v1:id,title,status,pri\nt1|Design login";
    const decoded = decodeFull(input);
    expect(decoded.rows[0]).toEqual(["t1", "Design login", "", ""]);
  });

  it("throws on too many fields", () => {
    const input = "#task@v1:id,title\nt1|Design|extra|fields";
    expect(() => decodeFull(input)).toThrow();
  });

  it("skips empty lines", () => {
    const input = "#task@v1:id,title\n\nt1|Hello\n\nt2|World\n";
    const decoded = decodeFull(input);
    expect(decoded.rows).toHaveLength(2);
  });

  it("throws on missing schema", () => {
    expect(() => decodeFull("")).toThrow();
  });
});

describe("decodeDeltas", () => {
  it("decodes update, create, delete", () => {
    const input = ">t1.status=done\n>t3|New task|todo+\n>t2-";
    const deltas = decodeDeltas(input);
    expect(deltas).toHaveLength(3);
    expect(deltas[0]).toEqual({ type: "update", id: "t1", field: "status", value: "done" });
    expect(deltas[1]).toEqual({ type: "create", row: ["t3", "New task", "todo"] });
    expect(deltas[2]).toEqual({ type: "delete", id: "t2" });
  });

  it("unescapes pipes in update value", () => {
    const deltas = decodeDeltas(">t1.title=X\\|Y");
    expect(deltas[0]).toEqual({ type: "update", id: "t1", field: "title", value: "X|Y" });
  });
});
