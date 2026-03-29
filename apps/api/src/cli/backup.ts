import fs from "node:fs";
import path from "node:path";
import { createDb } from "@tarmak/db";
import { sql } from "drizzle-orm";

export async function runBackup(args: string[]): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? "./tarmak.db";
  const destPath = args[0];

  if (!destPath) {
    console.error("Usage: tarmak backup <path>");
    process.exit(1);
  }

  if (!fs.existsSync(dbPath)) {
    console.error(`Database file not found: ${dbPath}`);
    process.exit(1);
  }

  const resolvedDest = path.resolve(destPath);
  const destDir = path.dirname(resolvedDest);

  if (!fs.existsSync(destDir)) {
    console.error(`Destination directory does not exist: ${destDir}`);
    process.exit(1);
  }

  // Checkpoint WAL to ensure all data is in the main DB file before copying
  const db = createDb(dbPath);
  db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);

  fs.copyFileSync(dbPath, resolvedDest);

  const stats = fs.statSync(resolvedDest);
  const sizeKb = (stats.size / 1024).toFixed(1);
  console.log(`Backup saved to ${resolvedDest} (${sizeKb} KB)`);
}
