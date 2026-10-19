import { createHash, randomBytes } from "node:crypto";
import type { User } from "@printrio/shared";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { sessions, users } from "../db/schema.ts";

export const SESSION_COOKIE = "printrio_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(db: Database, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function findSessionUser(db: Database, token: string): Promise<User | null> {
  const [row] = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

export async function deleteSession(db: Database, token: string) {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export async function deleteExpiredSessions(db: Database) {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
