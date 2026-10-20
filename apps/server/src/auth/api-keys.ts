import { createHash, randomBytes } from "node:crypto";
import type { User } from "@printrio/shared";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { apiKeys, users } from "../db/schema.ts";

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** Creates a personal API key; the key itself is returned once and only its hash is stored. */
export async function createApiKey(db: Database, userId: string, name: string) {
  const key = `prk_${randomBytes(24).toString("base64url")}`;
  const [row] = await db
    .insert(apiKeys)
    .values({ userId, name, keyHash: hashKey(key), prefix: key.slice(0, 8) })
    .returning();
  if (!row) throw new Error("Could not create the API key.");
  return { row, key };
}

export async function findApiKeyUser(db: Database, key: string): Promise<User | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      keyId: apiKeys.id,
    })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(eq(apiKeys.keyHash, hashKey(key)))
    .limit(1);
  if (!row) return null;
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.keyId));
  const { keyId: _keyId, ...user } = row;
  return user;
}
