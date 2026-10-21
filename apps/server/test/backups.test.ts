import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Backups } from "../src/backups/backups.ts";
import { createDatabase, pendingMigrations, runMigrations } from "../src/db/client.ts";
import { TEST_DATABASE_URL } from "./helpers.ts";

const quiet = { info() {}, warn() {}, error() {} };

describe("backups", () => {
  let dataDir: string;
  let database: ReturnType<typeof createDatabase>;
  let restored = 0;
  let backups: Backups;

  beforeEach(async () => {
    database = createDatabase(TEST_DATABASE_URL);
    const { db } = database;
    for (const { name } of await db.execute<{ name: string }>(
      sql`select nspname as name from pg_namespace where nspname like 'module\\_%' or nspname in ('public', 'drizzle')`,
    ))
      await db.execute(sql.raw(`drop schema "${name}" cascade`));
    await db.execute(sql`create schema public`);
    await runMigrations(db);
    dataDir = mkdtempSync(join(tmpdir(), "printrio-backup-"));
    restored = 0;
    backups = new Backups({
      db,
      databaseUrl: TEST_DATABASE_URL,
      dataDir,
      version: "1.0.0",
      log: quiet,
      onRestored: () => {
        restored++;
      },
    });
  });

  afterEach(async () => {
    await backups.stop();
    await database.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("backs up and restores the database, module data and instance files", async () => {
    if (!(await backups.toolsAvailable())) return; // pg_dump/psql missing on this machine
    const { db } = database;
    await db.execute(
      sql`insert into instance_settings (key, value) values ('workspace', '{"usageMode":"farm"}')`,
    );
    await db.execute(sql`create schema module_pro`);
    await db.execute(
      sql`create table module_pro.customers (id serial primary key, name text not null)`,
    );
    await db.execute(sql`insert into module_pro.customers (name) values ('Acme s.r.o.')`);
    writeFileSync(join(dataDir, "app-secret"), "secret-1\n");
    mkdirSync(join(dataDir, "files", "Orders"), { recursive: true });
    writeFileSync(join(dataDir, "files", "Orders", "bracket.gcode"), "G28\n");
    mkdirSync(join(dataDir, "modules"));
    writeFileSync(join(dataDir, "modules", "pro.json"), "{}");

    const dbOnly = await backups.create("manual");
    const full = await backups.create("manual", { includeFiles: true });
    expect(dbOnly).toMatchObject({ kind: "manual", version: "1.0.0" });
    expect(full.size).toBeGreaterThan(0);
    expect((await backups.list()).length).toBe(2);

    // Damage everything, add a table the backup does not know.
    await db.execute(sql`delete from instance_settings`);
    await db.execute(sql`update module_pro.customers set name = 'changed'`);
    await db.execute(sql`create table module_pro.later (id int)`);
    writeFileSync(join(dataDir, "app-secret"), "secret-2\n");
    rmSync(join(dataDir, "files"), { recursive: true });

    await backups.restore(full.name);
    expect(restored).toBe(1);
    const settings = await db.execute<{ value: string }>(
      sql`select value from instance_settings where key = 'workspace'`,
    );
    expect(settings[0]?.value).toContain("farm");
    const customers = await db.execute<{ name: string }>(
      sql`select name from module_pro.customers`,
    );
    expect(customers.map((row) => row.name)).toEqual(["Acme s.r.o."]);
    const later = await db.execute<{ exists: boolean }>(
      sql`select to_regclass('module_pro.later') is not null as exists`,
    );
    expect(later[0]?.exists).toBe(false);
    expect(readFileSync(join(dataDir, "app-secret"), "utf8")).toBe("secret-1\n");
    expect(readFileSync(join(dataDir, "files", "Orders", "bracket.gcode"), "utf8")).toBe("G28\n");
    expect(await pendingMigrations(db)).toBe(0);

    // A database-only backup leaves the library alone.
    rmSync(join(dataDir, "files"), { recursive: true });
    await backups.restore(dbOnly.name);
    expect(existsSync(join(dataDir, "files"))).toBe(false);
  });

  it("accepts uploaded backups, refuses foreign files and newer backups", async () => {
    if (!(await backups.toolsAvailable())) return;
    const { db } = database;
    const made = await backups.create("manual");
    const copy = join(tmpdir(), `upload-${Date.now()}.tar.gz`);
    writeFileSync(copy, readFileSync(backups.path(made.name)));
    await backups.remove(made.name);

    const uploaded = await backups.saveUpload(createReadStream(copy));
    expect(uploaded.kind).toBe("uploaded");
    rmSync(copy);

    const junk = join(tmpdir(), `junk-${Date.now()}.tar.gz`);
    writeFileSync(junk, "not a backup");
    await expect(backups.saveUpload(createReadStream(junk))).rejects.toThrow(
      /not a Printrio backup/,
    );
    rmSync(junk);

    // Made with more migrations than this database has: update first.
    await db.execute(
      sql`delete from drizzle.__drizzle_migrations where id = (select max(id) from drizzle.__drizzle_migrations)`,
    );
    // The startup check sees the missing migration and backs up first.
    expect(await pendingMigrations(db)).toBe(1);
    await expect(backups.restore(uploaded.name)).rejects.toThrow(/newer Printrio/);
    expect(restored).toBe(0);

    expect(() => backups.path("../../etc/passwd")).toThrow(/not found/);
    expect(() => backups.path("printrio-20260101-000000-manual-v1.tar.gz")).toThrow(/not found/);
  });

  it("keeps a limited number of scheduled and pre-update backups", async () => {
    if (!(await backups.toolsAvailable())) return;
    await backups.saveSettings({ enabled: true, hour: 3, keep: 2, includeFiles: false });
    let clock = Date.parse("2026-10-01T03:00:00Z");
    const timed = new Backups({
      db: database.db,
      databaseUrl: TEST_DATABASE_URL,
      dataDir,
      version: "1.0.0",
      log: quiet,
      now: () => new Date(clock),
    });
    for (let day = 0; day < 4; day++) {
      await timed.create("scheduled");
      clock += 86_400_000;
    }
    for (let i = 0; i < 4; i++) {
      await timed.create("pre-update");
      clock += 60_000;
    }
    await timed.create("manual");
    const kinds = (await timed.list()).map((entry) => entry.kind);
    expect(kinds.filter((kind) => kind === "scheduled")).toHaveLength(2);
    expect(kinds.filter((kind) => kind === "pre-update")).toHaveLength(3);
    expect(kinds.filter((kind) => kind === "manual")).toHaveLength(1);
  });
});
