import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("tarmak init", () => {
  let tmpDir: string;
  const originalCwd = process.cwd;

  beforeEach(() => {
    vi.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tarmak-init-"));
    process.cwd = () => tmpDir;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .mcp.json with stdio config", async () => {
    const { runInit } = await import("../../cli/init.js");
    await runInit(["--stdio"]);

    const mcpPath = path.join(tmpDir, ".mcp.json");
    expect(fs.existsSync(mcpPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
    expect(content.mcpServers.tarmak).toEqual({
      command: "npx",
      args: ["tarmak", "mcp"],
    });
  });

  it("creates .mcp.json with SSE config", async () => {
    const { runInit } = await import("../../cli/init.js");
    await runInit(["--server", "http://localhost:4000"]);

    const mcpPath = path.join(tmpDir, ".mcp.json");
    const content = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
    expect(content.mcpServers.tarmak).toEqual({
      type: "sse",
      url: "http://localhost:4000/mcp/sse",
    });
  });

  it("merges into existing .mcp.json without overwriting other servers", async () => {
    const mcpPath = path.join(tmpDir, ".mcp.json");
    fs.writeFileSync(
      mcpPath,
      JSON.stringify({ mcpServers: { other: { command: "other-mcp" } } }),
    );

    const { runInit } = await import("../../cli/init.js");
    await runInit(["--stdio"]);

    const content = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
    expect(content.mcpServers.other).toEqual({ command: "other-mcp" });
    expect(content.mcpServers.tarmak).toBeDefined();
  });

  it("creates .claude/settings.json with plugin reference", async () => {
    const { runInit } = await import("../../cli/init.js");
    await runInit(["--stdio"]);

    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    expect(fs.existsSync(settingsPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(content.plugins).toContain("tarmak");
  });

  it("merges into existing .claude/settings.json without duplicating", async () => {
    const claudeDir = path.join(tmpDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({ plugins: ["other-plugin"] }),
    );

    const { runInit } = await import("../../cli/init.js");
    await runInit(["--stdio"]);

    const content = JSON.parse(
      fs.readFileSync(path.join(claudeDir, "settings.json"), "utf-8"),
    );
    expect(content.plugins).toEqual(["other-plugin", "tarmak"]);
  });
});
