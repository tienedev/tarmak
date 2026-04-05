import fs from "node:fs";
import path from "node:path";

const SQLITE_MAGIC = "SQLite format 3";

export async function runRestore(args: string[]): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? "./tarmak.db";
  const srcPath = args[0];

  if (!srcPath) {
    console.error("Usage: tarmak restore <path>");
    process.exit(1);
  }

  const resolvedSrc = path.resolve(srcPath);

  if (!fs.existsSync(resolvedSrc)) {
    console.error(`Backup file not found: ${resolvedSrc}`);
    process.exit(1);
  }

  // Verify SQLite magic bytes
  const fd = fs.openSync(resolvedSrc, "r");
  const buf = Buffer.alloc(16);
  fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);

  const header = buf.toString("utf-8", 0, SQLITE_MAGIC.length);
  if (header !== SQLITE_MAGIC) {
    console.error("Invalid backup file: not a valid SQLite database");
    process.exit(1);
  }

  const resolvedDb = path.resolve(dbPath);
  fs.copyFileSync(resolvedSrc, resolvedDb);

  console.log(`Database restored from ${resolvedSrc}`);
}
