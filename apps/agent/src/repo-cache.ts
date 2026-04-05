import fs from "fs/promises";
import path from "path";
import os from "os";

export class RepoCache {
  private mappings: Map<string, string>;
  private filepath: string;

  private constructor(filepath: string, mappings: Map<string, string>) {
    this.filepath = filepath;
    this.mappings = mappings;
  }

  static defaultPath(): string {
    return path.join(os.homedir(), ".tarmak", "repo-cache.json");
  }

  static async load(filepath?: string): Promise<RepoCache> {
    const p = filepath ?? RepoCache.defaultPath();
    try {
      const raw = await fs.readFile(p, "utf-8");
      const obj = JSON.parse(raw) as Record<string, string>;
      return new RepoCache(p, new Map(Object.entries(obj)));
    } catch {
      return new RepoCache(p, new Map());
    }
  }

  get(repoUrl: string): string | undefined {
    return this.mappings.get(repoUrl);
  }

  set(repoUrl: string, workdir: string): void {
    this.mappings.set(repoUrl, workdir);
  }

  retain(predicate: (url: string, workdir: string) => boolean): void {
    for (const [url, workdir] of this.mappings) {
      if (!predicate(url, workdir)) {
        this.mappings.delete(url);
      }
    }
  }

  entries(): IterableIterator<[string, string]> {
    return this.mappings.entries();
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filepath), { recursive: true });
    const obj = Object.fromEntries(this.mappings);
    await fs.writeFile(this.filepath, JSON.stringify(obj, null, 2), "utf-8");
  }
}
