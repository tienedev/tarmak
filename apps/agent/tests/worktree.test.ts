import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { branchName, cleanupWorktree, createWorktree } from "../src/worktree.js";

describe("worktree", () => {
  it("generates correct branch name", () => {
    const name = branchName("task-1234-5678-abcd", "sess-aaaa-bbbb-cccc");
    expect(name).toBe("agent/task-123-sess-aaa");
  });

  describe("create/cleanup", () => {
    let repoDir: string;

    beforeEach(async () => {
      repoDir = path.join(os.tmpdir(), `tarmak-wt-test-${Date.now()}`);
      await fs.mkdir(repoDir, { recursive: true });
      execSync(
        "git init && git config user.email 'test@test.com' && git config user.name 'Test' && git commit --allow-empty -m init",
        { cwd: repoDir },
      );
    });

    afterEach(async () => {
      await fs.rm(repoDir, { recursive: true, force: true });
    });

    it("creates and cleans up a worktree", async () => {
      const sessionId = "test-session-id";
      const branch = branchName("task-abcd-1234", sessionId);

      const wtPath = await createWorktree(repoDir, sessionId, branch);
      expect(wtPath).toContain(".worktrees/test-session-id");

      const stat = await fs.stat(wtPath);
      expect(stat.isDirectory()).toBe(true);

      await cleanupWorktree(repoDir, sessionId, branch);

      await expect(fs.stat(wtPath)).rejects.toThrow();
    });
  });
});
