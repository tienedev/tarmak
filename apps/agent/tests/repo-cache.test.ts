import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RepoCache } from "../src/repo-cache.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("RepoCache", () => {
  const testDir = path.join(os.tmpdir(), "tarmak-cache-test");
  const cachePath = path.join(testDir, "repo-cache.json");

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("starts empty", async () => {
    const cache = await RepoCache.load(cachePath);
    expect(cache.get("https://github.com/foo/bar")).toBeUndefined();
  });

  it("sets and gets a mapping", async () => {
    const cache = await RepoCache.load(cachePath);
    cache.set("https://github.com/foo/bar", "/home/user/bar");
    expect(cache.get("https://github.com/foo/bar")).toBe("/home/user/bar");
  });

  it("persists to disk", async () => {
    const cache = await RepoCache.load(cachePath);
    cache.set("https://github.com/foo/bar", "/home/user/bar");
    await cache.save();

    const cache2 = await RepoCache.load(cachePath);
    expect(cache2.get("https://github.com/foo/bar")).toBe("/home/user/bar");
  });

  it("retains only matching entries", async () => {
    const cache = await RepoCache.load(cachePath);
    cache.set("a", "/exists");
    cache.set("b", "/gone");
    cache.retain((_, workdir) => workdir === "/exists");
    expect(cache.get("a")).toBe("/exists");
    expect(cache.get("b")).toBeUndefined();
  });
});
