import crypto from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@tarmak/db";
import { users, sessions } from "@tarmak/db";
import { resolveUser } from "../auth/resolve-user";

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(32);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}

function verifyPassword(password: string, hash: string): boolean {
  const parts = hash.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "hex");
  const storedKey = Buffer.from(parts[2]!, "hex");
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(storedKey, derivedKey);
}

function createSession(db: DB, userId: string): { token: string } {
  const token = crypto.randomUUID();
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const sessionDays = Number(process.env.TARMAK_SESSION_DAYS ?? 30);
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000).toISOString();
  const id = crypto.randomUUID();

  db.insert(sessions)
    .values({ id, user_id: userId, token_hash: tokenHash, expires_at: expiresAt })
    .run();

  return { token };
}

export function authRoutes(db: DB) {
  const app = new Hono();

  // POST /register
  app.post("/register", async (c) => {
    const parsed = registerSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
    }
    const { name, email, password } = parsed.data;

    // Check uniqueness
    const existing = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .get();
    if (existing) {
      return c.json({ error: "email already registered" }, 409);
    }

    const id = crypto.randomUUID();
    const passwordHash = hashPassword(password);

    db.insert(users)
      .values({ id, name, email, password_hash: passwordHash })
      .run();

    const { token } = createSession(db, id);

    return c.json({ token, user: { id, name, email } }, 201);
  });

  // POST /login
  app.post("/login", async (c) => {
    const parsed = loginSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
    }
    const { email, password } = parsed.data;

    const user = db.select().from(users).where(eq(users.email, email)).get();
    if (!user || !user.password_hash) {
      return c.json({ error: "invalid credentials" }, 401);
    }

    if (!verifyPassword(password, user.password_hash)) {
      return c.json({ error: "invalid credentials" }, 401);
    }

    const { token } = createSession(db, user.id);

    return c.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  });

  // GET /me
  app.get("/me", (c) => {
    const user = resolveUser(db, c.req.header("Authorization"));
    if (!user) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return c.json(user);
  });

  return app;
}
