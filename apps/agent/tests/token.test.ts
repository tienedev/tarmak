import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateToken, saveToken, loadToken, tokenPath } from "../src/token.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("token", () => {
  const testDir = path.join(os.tmpdir(), "tarmak-token-test");

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("generates a 64-char hex token", () => {
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates unique tokens", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });

  it("saves and loads token", async () => {
    const token = generateToken();
    const filepath = path.join(testDir, "agent-token");
    await saveToken(token, filepath);
    const loaded = await loadToken(filepath);
    expect(loaded).toBe(token);
  });

  it("returns null for missing token file", async () => {
    const loaded = await loadToken(path.join(testDir, "nonexistent"));
    expect(loaded).toBeNull();
  });
});
