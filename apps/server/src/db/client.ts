import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
