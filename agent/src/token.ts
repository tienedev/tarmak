import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";

export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function tokenPath(customPath?: string): string {
  if (customPath) return customPath;
  const dir = path.join(os.homedir(), ".tarmak");
  return path.join(dir, "agent-token");
}

export async function saveToken(token: string, filepath?: string): Promise<void> {
  const p = tokenPath(filepath);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, token, { encoding: "utf-8", mode: 0o600 });
}

export async function loadToken(filepath?: string): Promise<string | null> {
  try {
    const content = await fs.readFile(tokenPath(filepath), "utf-8");
    return content.trim() || null;
  } catch {
    return null;
  }
}
