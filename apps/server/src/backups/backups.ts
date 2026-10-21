import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { type BackupKind, type BackupSettings, backupSettingsSchema } from "@printrio/shared";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { instanceSettings } from "../db/schema.ts";

/**
 * Backups of an instance: the whole database (core and module schemas, via
 * pg_dump) plus the instance secret and, optionally, the G-code library, in
 * one .tar.gz under DATA_DIR/backups. Restoring replaces the database in one
 * transaction (nothing changes if it fails), copies the files back and
 * restarts the process so migrations bring the schema up to date.
 */

const SETTINGS_KEY = "backups";
const NAME =
  /^printrio-(\d{8}-\d{6})(?:-(\d+))?-(manual|scheduled|pre-update|uploaded)-v([\w.+-]+)\.tar\.gz$/;
/** Entries of DATA_DIR that are never backed up: the backups themselves and downloaded modules. */
const SKIP = new Set(["backups", "modules"]);
const FORMAT = 1;

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  enabled: true,
  hour: 3,
  keep: 7,
  includeFiles: false,
};

export interface BackupEntry {
  name: string;
  kind: BackupKind;
  version: string;
  createdAt: string;
  size: number;
}

interface Manifest {
  format: number;
  version: string;
  createdAt: string;
  kind: BackupKind;
  /** Applied core migrations when the backup was made. */
  migrations: number;
  /** DATA_DIR entries in the archive (besides manifest.json and database.sql). */
  data: string[];
}

export class BackupError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

function run(
  command: string,
  args: string[],
  options: { input?: string; env?: NodeJS.ProcessEnv } = {},
) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...options.env } });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`${command} failed: ${err.trim().split("\n").slice(-3).join(" ")}`)),
    );
    if (options.input !== undefined) child.stdin.end(options.input);
  });
}

const stamp = (date: Date) =>
  date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

export class Backups {
  readonly dir: string;
  private running: Promise<unknown> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly options: {
      db: Database;
      databaseUrl: string;
      dataDir: string;
      version: string;
      log: {
        info(message: string): void;
        warn(message: string): void;
        error(message: string): void;
      };
      now?: () => Date;
      /** Called after a restore; the default exits so Docker restarts Printrio. */
      onRestored?: () => void;
    },
  ) {
    this.dir = join(options.dataDir, "backups");
  }

  private now() {
    return this.options.now?.() ?? new Date();
  }

  /** pg_dump and psql must be installed (they are in the Docker image). */
  async toolsAvailable() {
    try {
      await run("pg_dump", ["--version"]);
      await run("psql", ["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  async settings(): Promise<BackupSettings> {
    const [row] = await this.options.db
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.key, SETTINGS_KEY));
    const parsed = backupSettingsSchema.safeParse({
      ...DEFAULT_BACKUP_SETTINGS,
      ...(row ? JSON.parse(row.value) : {}),
    });
    return parsed.success ? parsed.data : DEFAULT_BACKUP_SETTINGS;
  }

  async saveSettings(input: BackupSettings) {
    const value = JSON.stringify(backupSettingsSchema.parse(input));
    await this.options.db
      .insert(instanceSettings)
      .values({ key: SETTINGS_KEY, value })
      .onConflictDoUpdate({ target: instanceSettings.key, set: { value, updatedAt: new Date() } });
    return this.settings();
  }

  async list(): Promise<BackupEntry[]> {
    if (!existsSync(this.dir)) return [];
    const entries: (BackupEntry & { order: number })[] = [];
    for (const name of await readdir(this.dir)) {
      const match = NAME.exec(name);
      if (!match) continue;
      const info = await stat(join(this.dir, name));
      const [, when = "", n = "1", kind, version = ""] = match;
      const createdAt = `${when.slice(0, 4)}-${when.slice(4, 6)}-${when.slice(6, 8)}T${when.slice(9, 11)}:${when.slice(11, 13)}:${when.slice(13, 15)}Z`;
      entries.push({
        name,
        kind: kind as BackupKind,
        version,
        createdAt,
        size: info.size,
        order: Number(n),
      });
    }
    // Newest first; within one second the higher number is newer.
    return entries
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.order - a.order)
      .map(({ order: _order, ...entry }) => entry);
  }

  /** Full path of a backup; refuses anything that is not one of ours (no path traversal). */
  path(name: string) {
    if (!NAME.test(name)) throw new BackupError("Backup not found.", 404);
    const file = join(this.dir, name);
    if (!existsSync(file)) throw new BackupError("Backup not found.", 404);
    return file;
  }

  async remove(name: string) {
    await rm(this.path(name));
  }

  private async appliedMigrations() {
    try {
      const rows = await this.options.db.execute<{ count: number }>(
        sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
      );
      return Number(rows[0]?.count ?? 0);
    } catch {
      return 0;
    }
  }

  /** One backup at a time; the others wait. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = (this.running ?? Promise.resolve()).catch(() => {}).then(work);
    this.running = next.finally(() => {
      if (this.running === next) this.running = null;
    });
    return next;
  }

  create(kind: BackupKind, { includeFiles = false } = {}): Promise<BackupEntry> {
    return this.exclusive(async () => {
      if (!(await this.toolsAvailable()))
        throw new BackupError(
          "pg_dump is not installed. Use the Printrio Docker image or install the PostgreSQL client.",
          503,
        );
      await mkdir(this.dir, { recursive: true });
      const tmp = await mkdtemp(join(this.dir, ".tmp-"));
      try {
        await run("pg_dump", [
          "--no-owner",
          "--no-privileges",
          "--format=plain",
          `--file=${join(tmp, "database.sql")}`,
          this.options.databaseUrl,
        ]);
        const data = existsSync(this.options.dataDir)
          ? (await readdir(this.options.dataDir)).filter(
              (entry) =>
                !SKIP.has(entry) && !entry.startsWith(".") && (includeFiles || entry !== "files"),
            )
          : [];
        const created = this.now();
        const manifest: Manifest = {
          format: FORMAT,
          version: this.options.version,
          createdAt: created.toISOString(),
          kind,
          migrations: await this.appliedMigrations(),
          data,
        };
        await writeFile(join(tmp, "manifest.json"), JSON.stringify(manifest, null, 2));
        const name = await this.freeName(stamp(created), kind, this.options.version);
        const partial = join(tmp, "archive.tar.gz");
        const args = ["-czf", partial, "-C", tmp, "manifest.json", "database.sql"];
        if (data.length) args.push("-C", this.options.dataDir, ...data);
        await run("tar", args);
        await rename(partial, join(this.dir, name));
        await this.prune();
        this.options.log.info(`Backup ${name} created.`);
        return (await this.list()).find((entry) => entry.name === name) as BackupEntry;
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    });
  }

  /** printrio-<time>[-n]-<kind>-v<version>.tar.gz, numbered when two land in the same second. */
  private async freeName(when: string, kind: BackupKind, version: string) {
    const safe = version.replace(/[^\w.+-]/g, "_");
    for (let n = 1; ; n++) {
      const name = `printrio-${when}${n > 1 ? `-${n}` : ""}-${kind}-v${safe}.tar.gz`;
      if (!existsSync(join(this.dir, name))) return name;
    }
  }

  /** Keeps the newest `keep` scheduled backups and 3 pre-update backups; manual ones stay. */
  async prune() {
    const { keep } = await this.settings();
    const all = await this.list();
    const drop = [
      ...all.filter((entry) => entry.kind === "scheduled").slice(keep),
      ...all.filter((entry) => entry.kind === "pre-update").slice(3),
    ];
    for (const entry of drop) await rm(join(this.dir, entry.name), { force: true });
  }

  /** Stores an uploaded backup; returns its entry. */
  async saveUpload(source: NodeJS.ReadableStream) {
    await mkdir(this.dir, { recursive: true });
    const tmp = join(this.dir, `.upload-${Date.now()}.tar.gz`);
    try {
      await pipeline(source, createWriteStream(tmp));
      const manifest = await this.readManifest(tmp);
      const name = await this.freeName(
        stamp(new Date(manifest.createdAt)),
        "uploaded",
        manifest.version,
      );
      await rename(tmp, join(this.dir, name));
      return (await this.list()).find((entry) => entry.name === name) as BackupEntry;
    } finally {
      await rm(tmp, { force: true });
    }
  }

  private async readManifest(file: string): Promise<Manifest> {
    let text: string;
    try {
      text = await run("tar", ["-xzOf", file, "manifest.json"]);
    } catch {
      throw new BackupError("This is not a Printrio backup.");
    }
    let manifest: Manifest;
    try {
      manifest = JSON.parse(text) as Manifest;
    } catch {
      throw new BackupError("This is not a Printrio backup.");
    }
    if (
      manifest.format !== FORMAT ||
      typeof manifest.version !== "string" ||
      !Array.isArray(manifest.data)
    )
      throw new BackupError("This backup was made by an unsupported Printrio version.");
    return manifest;
  }

  /**
   * Replaces the database and instance files with the backup. The database part
   * runs in a single transaction: if anything fails, nothing changes.
   */
  restore(name: string): Promise<void> {
    return this.exclusive(async () => {
      if (!(await this.toolsAvailable())) throw new BackupError("psql is not installed.", 503);
      const file = this.path(name);
      const manifest = await this.readManifest(file);
      if (manifest.migrations > (await this.appliedMigrations()))
        throw new BackupError(
          `The backup is from a newer Printrio (${manifest.version}). Update Printrio first, then restore.`,
          409,
        );
      const tmp = await mkdtemp(join(this.dir, ".restore-"));
      try {
        await run("tar", ["-xzf", file, "-C", tmp]);
        const schemas = await this.options.db.execute<{ name: string }>(
          sql`select nspname as name from pg_namespace where nspname not like 'pg\\_%' and nspname <> 'information_schema'`,
        );
        const drop = schemas
          .map((row) => `DROP SCHEMA IF EXISTS "${row.name.replace(/"/g, '""')}" CASCADE;`)
          .join("\n");
        // pg_dump 17 writes a setting older servers do not know; it is not needed for the restore.
        const dump = (await readFile(join(tmp, "database.sql"), "utf8")).replace(
          /^SET transaction_timeout = .*$/m,
          "",
        );
        const script = `${drop}\nCREATE SCHEMA public;\n${dump}`;
        await writeFile(join(tmp, "restore.sql"), script);
        await run("psql", [
          "--quiet",
          "--no-psqlrc",
          "--single-transaction",
          "-v",
          "ON_ERROR_STOP=1",
          `--file=${join(tmp, "restore.sql")}`,
          this.options.databaseUrl,
        ]);
        for (const entry of manifest.data) {
          if (SKIP.has(entry) || entry.includes("/") || entry.startsWith(".")) continue;
          const source = join(tmp, entry);
          if (existsSync(source))
            await cp(source, join(this.options.dataDir, entry), { recursive: true, force: true });
        }
        this.options.log.warn(`Backup ${name} restored; restarting.`);
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
      (this.options.onRestored ?? (() => setTimeout(() => process.exit(0), 500).unref()))();
    });
  }

  /** Daily backup at the configured hour (server time), checked every 10 minutes. */
  start() {
    const tick = async () => {
      const settings = await this.settings();
      if (!settings.enabled) return;
      const now = this.now();
      if (now.getHours() !== settings.hour) return;
      const today = stamp(now).slice(0, 8);
      if (
        (await this.list()).some(
          (entry) => entry.kind === "scheduled" && entry.name.includes(`-${today}-`),
        )
      )
        return;
      await this.create("scheduled", { includeFiles: settings.includeFiles });
    };
    this.timer = setInterval(
      () =>
        void tick().catch((error) =>
          this.options.log.error(`Scheduled backup failed: ${error.message}`),
        ),
      10 * 60_000,
    );
    this.timer.unref?.();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running?.catch(() => {});
  }
}

/** Before migrations change an existing database: a database-only backup (best effort). */
export async function backupBeforeMigrations(backups: Backups, pendingMigrations: number) {
  if (pendingMigrations <= 0) return null;
  try {
    return await backups.create("pre-update");
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}
