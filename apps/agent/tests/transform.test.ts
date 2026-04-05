// agent/tests/transform.test.ts
import { describe, it, expect } from "vitest";
import { transformMessage, transformMessageAll } from "../src/sdk.js";

describe("transformMessage", () => {
  it("transforms result message", () => {
    const msg = { type: "result", subtype: "success", result: "Done. 2 files modified." };
    const result = transformMessage(msg);
    expect(result).toEqual({ type: "result", content: "Done. 2 files modified." });
  });

  it("returns null for system init messages", () => {
    const msg = { type: "system", subtype: "init", session_id: "abc" };
    const result = transformMessage(msg);
    expect(result).toBeNull();
  });

  it("transforms tool use summary (tool result) message", () => {
    const msg = {
      type: "tool_use_summary",
      tool_name: "Edit",
      tool_input: { file_path: "src/foo.ts" },
      output: "File edited successfully",
    };
    const result = transformMessage(msg);
    expect(result).toEqual({ type: "tool_result", tool: "Edit", output: "File edited successfully" });
  });

  it("returns null for unknown message types", () => {
    const msg = { type: "hook_progress", data: {} };
    const result = transformMessage(msg);
    expect(result).toBeNull();
  });
});

describe("transformMessageAll", () => {
  it("extracts both text and tool_use from assistant message", () => {
    const msg = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "I'll edit this file." },
          { type: "tool_use", name: "Edit", input: { file_path: "src/foo.ts" } },
        ],
      },
    };
    const results = transformMessageAll(msg);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ type: "assistant", content: "I'll edit this file." });
    expect(results[1]).toEqual({
      type: "tool_use",
      tool: "Edit",
      input: { file_path: "src/foo.ts" },
    });
  });

  it("handles tool_use_summary message", () => {
    const msg = {
      type: "tool_use_summary",
      tool_name: "Bash",
      output: "npm test passed",
    };
    const results = transformMessageAll(msg);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ type: "tool_result", tool: "Bash", output: "npm test passed" });
  });

  it("returns empty array for unknown types", () => {
    expect(transformMessageAll({ type: "hook_progress" })).toEqual([]);
  });
});
