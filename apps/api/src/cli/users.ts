import crypto from "node:crypto";
import { createDb, type DB } from "@tarmak/db";
import { users } from "@tarmak/db";
import { eq } from "drizzle-orm";

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(32);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}

function listUsers(db: DB) {
  return db.select({ id: users.id, name: users.name, email: users.email }).from(users).all();
}

function resetPassword(db: DB, email: string, newPassword: string): boolean {
  const user = db.select().from(users).where(eq(users.email, email)).get();
  if (!user) return false;

  const hash = hashPassword(newPassword);
  db.update(users)
    .set({ password_hash: hash })
    .where(eq(users.email, email))
    .run();

  return true;
}

export async function runUsers(args: string[]): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? "./tarmak.db";
  const subcommand = args[0];

  if (!subcommand) {
    console.error("Usage: tarmak users <list|reset-password>");
    process.exit(1);
  }

  const db = createDb(dbPath);

  switch (subcommand) {
    case "list": {
      const userList = listUsers(db);
      if (userList.length === 0) {
        console.log("No users found.");
        return;
      }
      console.log("ID\tName\tEmail");
      for (const u of userList) {
        console.log(`${u.id}\t${u.name}\t${u.email}`);
      }
      break;
    }

    case "reset-password": {
      const email = args[1];
      const newPassword = args[2];

      if (!email || !newPassword) {
        console.error("Usage: tarmak users reset-password <email> <new-password>");
        process.exit(1);
      }

      const ok = resetPassword(db, email, newPassword);
      if (!ok) {
        console.error(`User not found: ${email}`);
        process.exit(1);
      }

      console.log(`Password reset for ${email}`);
      break;
    }

    default:
      console.error(`Unknown users subcommand: ${subcommand}`);
      console.error("Usage: tarmak users <list|reset-password>");
      process.exit(1);
  }
}

// Exported for testing
export { listUsers, resetPassword, hashPassword };
