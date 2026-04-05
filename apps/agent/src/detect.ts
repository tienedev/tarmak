import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { RepoCache } from "./repo-cache.js";

const exec = promisify(execFile);

export function normalizeUrl(url: string): string {
  let u = url.trim().toLowerCase();
  // SSH: git@host:user/repo.git → host/user/repo
  const sshMatch = u.match(/^[\w-]+@([^:]+):(.+)$/);
  if (sshMatch) {
    u = `${sshMatch[1]}/${sshMatch[2]}`;
  } else {
    // Strip protocol
    u = u.replace(/^https?:\/\//, "");
  }
  // Strip .git suffix and trailing slash
  u = u.replace(/\.git$/, "").replace(/\/$/, "");
  return u;
}

export async function detectRepos(repoUrls: string[], cache: RepoCache): Promise<void> {
  // Prune stale entries (must be synchronous — retain() is not async)
  cache.retain((_, workdir) => existsSync(workdir));

  // Skip URLs already cached
  const needed = repoUrls.filter((url) => !cache.get(url));
  if (needed.length === 0) return;

  const normalizedNeeded = new Map(needed.map((url) => [normalizeUrl(url), url]));

  const gitDirs = await findGitDirs();
  for (const gitDir of gitDirs) {
    const remoteUrl = await readRemoteUrl(gitDir);
    if (!remoteUrl) continue;

    const normalized = normalizeUrl(remoteUrl);
    const originalUrl = normalizedNeeded.get(normalized);
    if (originalUrl) {
      const repoDir = path.dirname(gitDir);
      cache.set(originalUrl, repoDir);
      normalizedNeeded.delete(normalized);
    }

    if (normalizedNeeded.size === 0) break;
  }

  await cache.save();
}

async function findGitDirs(): Promise<string[]> {
  // Try platform-specific fast search first
  if (process.platform === "darwin") {
    try {
      const { stdout } = await exec("mdfind", [
        'kMDItemFSName == ".git" && kMDItemContentType == "public.folder"',
      ]);
      return stdout
        .split("\n")
        .filter(Boolean)
        .filter((p) => p.endsWith(".git"));
    } catch {
      // fallback to directory scan
    }
  } else if (process.platform === "linux") {
    try {
      const { stdout } = await exec("locate", ["-r", "/\\.git$"], {
        timeout: 5000,
      });
      const dirs = stdout
        .split("\n")
        .filter(Boolean)
        .filter((p) => p.endsWith(".git"));
      if (dirs.length > 0) return dirs;
    } catch {
      // locate not installed or db not built — fallback to directory scan
    }
  }

  // Scan common directories
  const home = os.homedir();
  const dirs = ["Projects", "Projets", "Developer", "code", "repos", "src"].map((d) =>
    path.join(home, d),
  );

  const results: string[] = [];
  for (const dir of dirs) {
    await scanForGitDirs(dir, 3, results);
  }
  return results;
}

async function scanForGitDirs(dir: string, maxDepth: number, results: string[]): Promise<void> {
  if (maxDepth <= 0) return;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "target") {
        if (entry.name === ".git") {
          results.push(path.join(dir, entry.name));
        }
        continue;
      }
      await scanForGitDirs(path.join(dir, entry.name), maxDepth - 1, results);
    }
  } catch {
    // permission denied, etc.
  }
}

async function readRemoteUrl(gitDir: string): Promise<string | null> {
  try {
    const configPath = path.join(gitDir, "config");
    const content = await fs.readFile(configPath, "utf-8");
    const match = content.match(/\[remote "origin"\][^[]*url\s*=\s*(.+)/);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}
