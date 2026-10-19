import { sql } from "drizzle-orm";
import { buildApp, defaultDriverFactories } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { SecretBox } from "../src/crypto.ts";
import { createDatabase, runMigrations } from "../src/db/client.ts";
import { PrinterManager } from "../src/printers/manager.ts";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://printrio:printrio@localhost:5432/printrio_test";

/** Builds an app against a freshly migrated, empty test database. */
export async function createTestApp() {
  const { db, close } = createDatabase(TEST_DATABASE_URL);
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);

  const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: TEST_DATABASE_URL });
  // Short backoff so reconnect behaviour is observable in tests.
  const manager = new PrinterManager(defaultDriverFactories(), 50);
  const app = await buildApp({
    config,
    db,
    secrets: new SecretBox("test-secret-test-secret-test-secret"),
    manager,
  });
  return {
    app,
    db,
    async close() {
      await app.close();
      await close();
    },
  };
}

export function sessionCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!header) throw new Error("Expected a Set-Cookie header");
  return header.split(";")[0] ?? "";
}
