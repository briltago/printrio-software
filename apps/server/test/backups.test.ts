import { execFileSync } from "node:child_process";
import {
  chmodSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Backups, withoutOwnRestriction } from "../src/backups/backups.ts";
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

  describe("hostile archives", () => {
    let work: string;
    let marker: string;

    beforeEach(() => {
      work = mkdtempSync(join(tmpdir(), "printrio-evil-"));
      marker = join(work, "pwned");
    });
    afterEach(() => rmSync(work, { recursive: true, force: true }));

    /** A backup archive made by hand: `prepare` fills the folder, `members` are packed in this order. */
    const craft = (
      options: {
        sql?: string;
        data?: string[];
        members?: string[];
        prepare?: (root: string) => void;
        tarArgs?: string[];
      } = {},
    ) => {
      const root = mkdtempSync(join(work, "archive-"));
      writeFileSync(
        join(root, "manifest.json"),
        JSON.stringify({
          format: 1,
          version: "1.0.0",
          createdAt: "2026-01-01T00:00:00.000Z",
          kind: "manual",
          migrations: 0,
          data: options.data ?? [],
        }),
      );
      writeFileSync(join(root, "database.sql"), options.sql ?? "SELECT 1;\n");
      options.prepare?.(root);
      const file = join(work, `crafted-${Math.random().toString(36).slice(2)}.tar.gz`);
      execFileSync("tar", [
        "-czf",
        file,
        ...(options.tarArgs ?? []),
        "-C",
        root,
        "manifest.json",
        "database.sql",
        ...(options.members ?? []),
      ]);
      return file;
    };
    /** Puts an archive among the backups as if it had been there all along (no upload checks). */
    const plant = (file: string) => {
      const name = `printrio-20260101-000000-${Math.floor(Math.random() * 1e6)}-uploaded-v1.0.0.tar.gz`;
      mkdirSync(backups.dir, { recursive: true });
      writeFileSync(join(backups.dir, name), readFileSync(file));
      return name;
    };
    const settingsCount = async () =>
      Number(
        (
          await database.db.execute<{ n: number }>(
            sql`select count(*)::int as n from instance_settings`,
          )
        )[0]?.n,
      );

    it("never runs psql meta-commands from a backup, and changes nothing when it finds one", async () => {
      if (!(await backups.toolsAvailable())) return;
      await database.db.execute(
        sql`insert into instance_settings (key, value) values ('keep', '{}')`,
      );
      const attacks = [
        `\\! touch ${marker}\n`,
        `SELECT 1;\n\\! touch ${marker}\n`,
        `SELECT 1 \\! touch ${marker}\n`,
        `\\o |touch ${marker}\nSELECT 1;\n`,
        `\\copy (SELECT 1) TO PROGRAM 'touch ${marker}'\n`,
        `SELECT 'touch ${marker}' \\gexec\n\\setenv PAGER 'touch ${marker}'\n`,
        `\\i /etc/passwd\n`,
        // Trying to leave restricted mode: with a guessed key, or with the dump's own pair.
        `\\unrestrict 0000\n\\! touch ${marker}\n`,
        `\\restrict abc\nSELECT 1;\n\\unrestrict abc\n\\! touch ${marker}\n`,
        `\\restrict abc\nCREATE TEMP TABLE x (a text);\nCOPY x FROM stdin;\n\\.\n\\unrestrict abc\n\\unrestrict abc\n\\! touch ${marker}\n`,
        // A COPY statement hidden in a string, so the next lines are commands, not table data.
        `SELECT 'COPY t FROM stdin;';\n\\! touch ${marker}\n\\.\n`,
      ];
      for (const attack of attacks) {
        const name = plant(craft({ sql: attack }));
        await expect(backups.restore(name), attack).rejects.toThrow(/was not restored/);
        expect(existsSync(marker), attack).toBe(false);
      }
      // The failed restores ran in one transaction each: the database is as it was.
      expect(await settingsCount()).toBe(1);
      expect(restored).toBe(0);
    });

    it("runs a backup's SQL without superuser rights, and leaves nothing behind", async () => {
      if (!(await backups.toolsAvailable())) return;
      const { db } = database;
      const [me] = await db.execute<{ super: boolean }>(
        sql`select rolsuper as super from pg_roles where rolname = current_user`,
      );
      if (!me?.super) return; // only a superuser role has anything to take away
      await db.execute(sql`insert into instance_settings (key, value) values ('keep', '{}')`);
      // The database server runs as another OS user: let it write here, so a marker would show.
      chmodSync(work, 0o777);
      const attacks = [
        `COPY (SELECT 1) TO PROGRAM 'touch ${marker}';\n`,
        `DO $$ BEGIN EXECUTE 'COPY (SELECT 1) TO PROGRAM ''touch ${marker}'''; END $$;\n`,
        `CREATE TABLE public.t (a text);\nCOPY public.t FROM PROGRAM 'touch ${marker}';\n`,
        `COPY (SELECT 1) TO '${marker}';\n`,
        `CREATE TABLE public.t (a text);\nCOPY public.t FROM '/etc/passwd';\n`,
        `SELECT pg_read_file('/etc/passwd');\n`,
        `CREATE ROLE printrio_evil SUPERUSER LOGIN PASSWORD 'x';\n`,
        `ALTER ROLE CURRENT_USER SUPERUSER;\n`,
        `RESET SESSION AUTHORIZATION;\nRESET ROLE;\nCOPY (SELECT 1) TO PROGRAM 'touch ${marker}';\n`,
        `SET ROLE printrio;\nCOPY (SELECT 1) TO PROGRAM 'touch ${marker}';\n`,
        `ALTER SYSTEM SET log_statement = 'all';\n`,
      ];
      for (const attack of attacks) {
        const name = plant(craft({ sql: attack }));
        await expect(backups.restore(name), attack).rejects.toThrow();
        expect(existsSync(marker), attack).toBe(false);
      }
      expect(restored).toBe(0);
      // Each failed restore was one transaction: the data is as it was …
      expect(await settingsCount()).toBe(1);
      // … the temporary role is gone, no role was created, and Printrio's role owns its schemas again.
      const roles = await db.execute<{ name: string }>(
        sql`select rolname::text as name from pg_roles where rolname like 'printrio\_restore\_%' or rolname = 'printrio_evil'`,
      );
      expect(roles).toHaveLength(0);
      const owners = await db.execute<{ schema: string; owner: string; me: string }>(
        sql`select nspname::text as schema, pg_get_userbyid(nspowner)::text as owner, current_user::text as me
              from pg_namespace where nspname in ('public', 'drizzle')`,
      );
      expect(owners.length).toBe(2);
      for (const row of owners) expect(row.owner, row.schema).toBe(row.me);
      const typical = plant(craft({ sql: attacks[0] }));
      await expect(backups.restore(typical)).rejects.toThrow(
        /database rights a Printrio backup never needs/,
      );
    });

    it("hands restored tables back to Printrio's own role", async () => {
      if (!(await backups.toolsAvailable())) return;
      const { db } = database;
      const made = await backups.create("manual");
      await backups.restore(made.name);
      const foreign = await db.execute<{ name: string }>(
        sql`select c.relname::text as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname in ('public', 'drizzle') and pg_get_userbyid(c.relowner) <> current_user`,
      );
      expect(foreign).toHaveLength(0);
      // A second restore, and normal use afterwards, still work.
      await backups.restore(made.name);
      await db.execute(sql`insert into instance_settings (key, value) values ('after', '{}')`);
      expect(await pendingMigrations(db)).toBe(0);
      const roles = await db.execute(
        sql`select 1 from pg_roles where rolname like 'printrio\_restore\_%'`,
      );
      expect(roles).toHaveLength(0);
    });

    it("restores table data that only looks like a meta-command", async () => {
      if (!(await backups.toolsAvailable())) return;
      const { db } = database;
      await db.execute(sql`create schema module_pro`);
      await db.execute(sql`create table module_pro.notes (body text)`);
      // In COPY format these rows start with a backslash: "\restrict abc", "\\! id", "\N".
      await db.execute(
        sql`insert into module_pro.notes (body) values (E'\restrict abc'), (E'\\\\! id'), (NULL), (E'\runrestrict abc')`,
      );
      const made = await backups.create("manual");
      await db.execute(sql`delete from module_pro.notes`);
      await backups.restore(made.name);
      const rows = await db.execute<{ body: string | null }>(
        sql`select body from module_pro.notes`,
      );
      expect(rows.map((row) => row.body)).toEqual([
        "\restrict abc",
        "\\! id",
        null,
        "\runrestrict abc",
      ]);
    });

    it("drops only pg_dump's own restriction lines", () => {
      const dump = [
        "-- PostgreSQL database dump",
        "\\restrict abc123",
        "SET statement_timeout = 0;",
        "COPY public.t (a) FROM stdin;",
        "\\restrict inside",
        "\\unrestrict inside",
        "\\.",
        "\\unrestrict abc123",
        "",
      ].join("\n");
      expect(withoutOwnRestriction(dump).split("\n")).toEqual([
        "-- PostgreSQL database dump",
        "SET statement_timeout = 0;",
        "COPY public.t (a) FROM stdin;",
        "\\restrict inside",
        "\\unrestrict inside",
        "\\.",
        "",
      ]);
      // A second pair, or one in the wrong place, stays and is refused by psql.
      const twice = "\\restrict a\n\\restrict b\nSELECT 1;\n\\unrestrict b\n\\unrestrict a\n";
      expect(withoutOwnRestriction(twice)).toBe("\\restrict b\nSELECT 1;\n\\unrestrict b\n");
    });

    it("refuses archives with links, special paths or a wrong layout", async () => {
      if (!(await backups.toolsAvailable())) return;
      const outside = join(work, "outside");
      mkdirSync(outside);
      const hostile: [string, string][] = [
        [
          "a symlink in the library",
          craft({
            data: ["files"],
            members: ["files"],
            prepare: (root) => {
              mkdirSync(join(root, "files"));
              symlinkSync(outside, join(root, "files", "escape"));
            },
          }),
        ],
        [
          "the library itself as a symlink",
          craft({
            data: ["files"],
            members: ["files"],
            prepare: (root) => symlinkSync(outside, join(root, "files")),
          }),
        ],
        [
          "the secret as a symlink",
          craft({
            data: ["app-secret"],
            members: ["app-secret"],
            prepare: (root) => symlinkSync("/etc/passwd", join(root, "app-secret")),
          }),
        ],
        [
          "the dump as a symlink",
          craft({
            prepare: (root) => {
              rmSync(join(root, "database.sql"));
              symlinkSync("/etc/passwd", join(root, "database.sql"));
            },
          }),
        ],
        [
          "a path that leaves the archive",
          craft({
            members: ["evil"],
            tarArgs: ["--transform", "s,^evil,../evil,"],
            prepare: (root) => writeFileSync(join(root, "evil"), "x"),
          }),
        ],
        [
          "an absolute path",
          craft({
            members: ["evil"],
            tarArgs: ["-P", "--transform", `s,^evil,${join(work, "abs-evil")},`],
            prepare: (root) => writeFileSync(join(root, "evil"), "x"),
          }),
        ],
      ];
      for (const [what, file] of hostile) {
        // Refused when uploaded …
        await expect(backups.saveUpload(createReadStream(file)), what).rejects.toThrow(
          /cannot be used|not a Printrio backup/,
        );
        // … and when the file got into the backup folder some other way.
        await expect(backups.restore(plant(file)), what).rejects.toThrow(
          /cannot be used|not a Printrio backup/,
        );
      }
      expect(existsSync(join(work, "evil"))).toBe(false);
      expect(existsSync(join(work, "abs-evil"))).toBe(false);
      expect(existsSync(join(outside, "x"))).toBe(false);
      expect(restored).toBe(0);
      expect((await backups.list()).every((entry) => entry.kind === "uploaded")).toBe(true);

      // The library must be a folder and the secret a file.
      const swapped = craft({
        data: ["files", "app-secret"],
        members: ["files", "app-secret"],
        prepare: (root) => {
          writeFileSync(join(root, "files"), "not a folder");
          mkdirSync(join(root, "app-secret"));
        },
      });
      await expect(backups.restore(plant(swapped))).rejects.toThrow(/cannot be used/);
      expect(existsSync(join(dataDir, "files"))).toBe(false);
      expect(existsSync(join(dataDir, "app-secret"))).toBe(false);
    });

    it("writes only the secret and the library back, whatever the archive and its manifest hold", async () => {
      if (!(await backups.toolsAvailable())) return;
      // A database a restore can run on: taken from a real backup.
      const real = await backups.create("manual");
      const realDir = mkdtempSync(join(work, "real-"));
      execFileSync("tar", ["-xzf", backups.path(real.name), "-C", realDir, "database.sql"]);
      const file = craft({
        sql: readFileSync(join(realDir, "database.sql"), "utf8"),
        data: [
          "app-secret",
          "files",
          "modules",
          "backups",
          "extra.txt",
          ".hidden",
          "../outside",
          "files/../../x",
        ],
        members: ["app-secret", "files", "modules", "backups", "extra.txt", ".hidden"],
        prepare: (root) => {
          writeFileSync(join(root, "app-secret"), "from-backup\n");
          mkdirSync(join(root, "files"));
          writeFileSync(join(root, "files", "part.gcode"), "G28\n");
          mkdirSync(join(root, "modules", "pro", "9.9.9"), { recursive: true });
          writeFileSync(
            join(root, "modules", "pro", "9.9.9", "server.mjs"),
            "throw new Error('planted')",
          );
          mkdirSync(join(root, "backups"));
          writeFileSync(join(root, "backups", "printrio-20200101-000000-manual-v1.tar.gz"), "x");
          writeFileSync(join(root, "extra.txt"), "x");
          writeFileSync(join(root, ".hidden"), "x");
        },
      });
      const uploaded = await backups.saveUpload(createReadStream(file));
      await backups.restore(uploaded.name);
      expect(restored).toBe(1);
      expect(readFileSync(join(dataDir, "app-secret"), "utf8")).toBe("from-backup\n");
      expect(readFileSync(join(dataDir, "files", "part.gcode"), "utf8")).toBe("G28\n");
      expect(existsSync(join(dataDir, "modules"))).toBe(false);
      expect(existsSync(join(dataDir, "extra.txt"))).toBe(false);
      expect(existsSync(join(dataDir, ".hidden"))).toBe(false);
      expect(existsSync(join(backups.dir, "printrio-20200101-000000-manual-v1.tar.gz"))).toBe(
        false,
      );

      // Listed in the manifest but absent from the archive: skipped, not an error.
      const partial = craft({
        sql: readFileSync(join(realDir, "database.sql"), "utf8"),
        data: ["app-secret", "files"],
      });
      await backups.restore(plant(partial));
      expect(restored).toBe(2);
    });

    it("backs up only the secret and the library from the data folder", async () => {
      if (!(await backups.toolsAvailable())) return;
      writeFileSync(join(dataDir, "app-secret"), "s\n");
      mkdirSync(join(dataDir, "files"));
      writeFileSync(join(dataDir, "stray.txt"), "x");
      mkdirSync(join(dataDir, "modules"));
      const made = await backups.create("manual", { includeFiles: true });
      const members = execFileSync("tar", ["-tzf", backups.path(made.name)], { encoding: "utf8" })
        .split("\n")
        .filter(Boolean)
        .map((name) => name.replace(/\/$/, ""));
      expect(members.sort()).toEqual(["app-secret", "database.sql", "files", "manifest.json"]);
    });
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
