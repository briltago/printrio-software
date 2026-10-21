import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema.ts";

export type Database = ReturnType<typeof createDatabase>["db"];

export function createDatabase(url: string) {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}

export async function runMigrations(db: Database, migrationsFolder = defaultMigrationsFolder()) {
  await migrate(db, { migrationsFolder });
}

/**
 * Migrations not yet applied to an existing database (0 for a fresh database,
 * which has nothing to lose).
 */
export async function pendingMigrations(
  db: Database,
  migrationsFolder = defaultMigrationsFolder(),
) {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as {
    entries: unknown[];
  };
  try {
    const rows = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    const applied = Number(rows[0]?.count ?? 0);
    return applied === 0 ? 0 : Math.max(0, journal.entries.length - applied);
  } catch {
    return 0;
  }
}

function defaultMigrationsFolder() {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  // This file runs from src/db/ in development and is bundled into dist/ for production.
  const candidates = ["../../drizzle", "../drizzle"].map((p) =>
    fileURLToPath(new URL(p, import.meta.url)),
  );
  const found = candidates.find((dir) => existsSync(dir));
  if (!found) throw new Error("Database migrations folder not found; set MIGRATIONS_DIR.");
  return found;
}
