import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

const exec = promisify(execFile);

export function branchName(taskId: string, sessionId: string): string {
  const taskShort = taskId.slice(0, 8);
  const sessShort = sessionId.slice(0, 8);
  return `agent/${taskShort}-${sessShort}`;
}

export async function createWorktree(
  repoDir: string,
  sessionId: string,
  branch: string
): Promise<string> {
  const wtDir = path.join(repoDir, ".worktrees", sessionId);
  await ensureGitignore(repoDir);
  await exec("git", ["worktree", "add", wtDir, "-b", branch], {
    cwd: repoDir,
  });
  return wtDir;
}

export async function cleanupWorktree(
  repoDir: string,
  sessionId: string,
  branch: string
): Promise<void> {
  const wtDir = path.join(repoDir, ".worktrees", sessionId);
  try {
    await exec("git", ["worktree", "remove", "--force", wtDir], {
      cwd: repoDir,
    });
  } catch {
    // best-effort
  }
  try {
    await exec("git", ["branch", "-D", branch], { cwd: repoDir });
  } catch {
    // best-effort
  }
}

export async function cleanupOrphanedWorktrees(
  repoDir: string
): Promise<void> {
  const wtBase = path.join(repoDir, ".worktrees");
  try {
    const entries = await fs.readdir(wtBase);
    for (const entry of entries) {
      try {
        await exec("git", ["worktree", "remove", "--force", path.join(wtBase, entry)], {
          cwd: repoDir,
        });
      } catch {
        // skip
      }
    }
  } catch {
    // .worktrees/ doesn't exist — nothing to clean
  }
}

async function ensureGitignore(repoDir: string): Promise<void> {
  const gitignorePath = path.join(repoDir, ".gitignore");
  try {
    const content = await fs.readFile(gitignorePath, "utf-8");
    if (content.includes(".worktrees/")) return;
    await fs.appendFile(gitignorePath, "\n.worktrees/\n");
  } catch {
    await fs.writeFile(gitignorePath, ".worktrees/\n");
  }
}
