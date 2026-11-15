import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
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
  /^printrio-(\d{8}-\d{6})(?:-(\d+))?-(manual|scheduled|pre-update|uploaded)-v([\w.+-]+)\.tar\.gz(?:\.enc)?$/;
/**
 * The only entries of DATA_DIR a backup holds and a restore writes back: the
 * instance secret and the G-code library. Backups themselves and downloaded
 * modules (fetched again, signature-checked) are never part of one, and
 * nothing else in an archive is ever copied into DATA_DIR.
 */
const DATA_ENTRIES = ["app-secret", "files"] as const;
const isDataEntry = (entry: string) => (DATA_ENTRIES as readonly string[]).includes(entry);
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
        : reject(
            // The short message is shown to the user; `stderr` keeps everything for checks.
            Object.assign(
              new Error(`${command} failed: ${err.trim().split("\n").slice(-3).join(" ")}`),
              { stderr: err },
            ),
          ),
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
      /**
       * BACKUP_PASSPHRASE: when set, new backups are encrypted with it
       * (….tar.gz.enc) and encrypted backups can be read. Without it a backup
       * is a plain archive that holds the instance secret and password hashes.
       */
      passphrase?: string;
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
    // The caller gets the failure; the queue itself must not turn it into an unhandled rejection.
    const settled: Promise<unknown> = next
      .catch(() => {})
      .finally(() => {
        if (this.running === settled) this.running = null;
      });
    this.running = settled;
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
              (entry) => isDataEntry(entry) && (includeFiles || entry !== "files"),
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
        const name = await this.freeName(
          stamp(created),
          kind,
          this.options.version,
          Boolean(this.options.passphrase),
        );
        const partial = join(tmp, "archive.tar.gz");
        const args = ["-czf", partial, "-C", tmp, "manifest.json", "database.sql"];
        if (data.length) args.push("-C", this.options.dataDir, ...data);
        await run("tar", args);
        if (this.options.passphrase) {
          await encryptFile(partial, `${partial}.enc`, this.options.passphrase);
          await rename(`${partial}.enc`, join(this.dir, name));
        } else await rename(partial, join(this.dir, name));
        await this.prune();
        this.options.log.info(`Backup ${name} created.`);
        return (await this.list()).find((entry) => entry.name === name) as BackupEntry;
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    });
  }

  /** printrio-<time>[-n]-<kind>-v<version>.tar.gz, numbered when two land in the same second. */
  private async freeName(when: string, kind: BackupKind, version: string, encrypted = false) {
    const safe = version.replace(/[^\w.+-]/g, "_");
    for (let n = 1; ; n++) {
      const name = `printrio-${when}${n > 1 ? `-${n}` : ""}-${kind}-v${safe}.tar.gz${encrypted ? ".enc" : ""}`;
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
      const archive = await this.plainArchive(tmp);
      let manifest: Manifest;
      try {
        await this.inspectArchive(archive.path);
        manifest = await this.readManifest(archive.path);
      } finally {
        await archive.release();
      }
      const name = await this.freeName(
        stamp(new Date(manifest.createdAt)),
        "uploaded",
        manifest.version,
        archive.encrypted,
      );
      await rename(tmp, join(this.dir, name));
      return (await this.list()).find((entry) => entry.name === name) as BackupEntry;
    } finally {
      await rm(tmp, { force: true });
    }
  }

  /**
   * The archive as a plain .tar.gz: itself, or — for an encrypted backup — a
   * decrypted temporary copy that `release` deletes.
   */
  private async plainArchive(file: string) {
    if (!(await isEncrypted(file)))
      return { path: file, encrypted: false, release: async () => {} };
    if (!this.options.passphrase)
      throw new BackupError(
        "This backup is encrypted. Set BACKUP_PASSPHRASE to the passphrase it was made with.",
      );
    const path = join(this.dir, `.plain-${randomBytes(6).toString("hex")}.tar.gz`);
    try {
      await decryptFile(file, path, this.options.passphrase);
    } catch {
      await rm(path, { force: true });
      throw new BackupError(
        "This backup could not be decrypted: BACKUP_PASSPHRASE is not the passphrase it was made with, or the file is damaged.",
      );
    }
    return { path, encrypted: true, release: () => rm(path, { force: true }) };
  }

  /**
   * Checks an archive before anything is extracted from it and returns its
   * top-level entries. A Printrio backup holds only regular files and folders,
   * all below its own root; links, devices and paths that leave the archive
   * (which could make the extraction write elsewhere) are refused.
   */
  private async inspectArchive(file: string): Promise<Set<string>> {
    let listing: string;
    let names: string;
    try {
      listing = await run("tar", ["-tzvf", file]);
      names = await run("tar", ["-tzf", file]);
    } catch {
      throw new BackupError("This is not a Printrio backup.");
    }
    // `tar -tv` starts each entry with its type: "-" file, "d" folder, "l"/"h" links, …
    for (const line of listing.split("\n"))
      if (line && line[0] !== "-" && line[0] !== "d")
        throw new BackupError("This backup contains links or special files and cannot be used.");
    const top = new Set<string>();
    for (const name of names.split("\n")) {
      if (!name) continue;
      const parts = name.replace(/\/+$/, "").split("/");
      if (
        name.startsWith("/") ||
        parts.some((part) => part === ".." || part === "." || part === "")
      )
        throw new BackupError("This backup contains unexpected paths and cannot be used.");
      top.add(parts[0] as string);
    }
    if (!top.has("manifest.json") || !top.has("database.sql"))
      throw new BackupError("This is not a Printrio backup.");
    return top;
  }

  /**
   * A temporary login role for one restore, when Printrio's own role is a
   * superuser: it owns the schemas (so it can replace them) and may create new
   * ones, nothing more. `release` hands everything back and removes the role,
   * whether the restore worked or not. Null when the own role is no superuser:
   * the restore then runs as that role, which has no special rights either.
   */
  private async restrictedRole(schemas: string[]) {
    const { db } = this.options;
    const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;
    const [me] = await db.execute<{ super: boolean; name: string; database: string }>(
      sql`select rolsuper as super, current_user::text as name, current_database()::text as database from pg_roles where rolname = current_user`,
    );
    if (!me?.super) return null;
    const drop = async (role: string) => {
      await db.execute(sql.raw(`REASSIGN OWNED BY ${ident(role)} TO ${ident(me.name)}`));
      await db.execute(sql.raw(`DROP OWNED BY ${ident(role)}`));
      await db.execute(sql.raw(`DROP ROLE IF EXISTS ${ident(role)}`));
    };
    // Left behind by a restore that was interrupted (e.g. the container stopped).
    for (const { name } of await db.execute<{ name: string }>(
      sql`select rolname::text as name from pg_roles where rolname like 'printrio\_restore\_%'`,
    ))
      await drop(name);
    const role = `printrio_restore_${randomBytes(6).toString("hex")}`;
    const password = randomBytes(24).toString("hex");
    await db.execute(
      sql.raw(
        `CREATE ROLE ${ident(role)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      ),
    );
    try {
      await db.execute(sql.raw(`GRANT CREATE ON DATABASE ${ident(me.database)} TO ${ident(role)}`));
      for (const schema of schemas)
        await db.execute(sql.raw(`ALTER SCHEMA ${ident(schema)} OWNER TO ${ident(role)}`));
    } catch (error) {
      await drop(role);
      throw error;
    }
    const url = new URL(this.options.databaseUrl);
    url.username = role;
    url.password = password;
    return { url: url.toString(), release: () => drop(role) };
  }

  /** After extraction: nothing but regular files and folders may be in the tree. */
  private async assertPlainTree(path: string, expectDirectory?: boolean): Promise<void> {
    const info = await lstat(path);
    if (expectDirectory !== undefined && info.isDirectory() !== expectDirectory)
      throw new BackupError("This backup contains unexpected entries and cannot be used.");
    if (info.isDirectory()) {
      for (const entry of await readdir(path)) await this.assertPlainTree(join(path, entry));
    } else if (!info.isFile()) {
      throw new BackupError("This backup contains links or special files and cannot be used.");
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
      const archive = await this.plainArchive(this.path(name));
      const file = archive.path;
      try {
        await this.restoreArchive(name, file);
      } finally {
        await archive.release();
      }
      (this.options.onRestored ?? (() => setTimeout(() => process.exit(0), 500).unref()))();
    });
  }

  private async restoreArchive(name: string, file: string) {
    {
      const top = await this.inspectArchive(file);
      const manifest = await this.readManifest(file);
      if (manifest.migrations > (await this.appliedMigrations()))
        throw new BackupError(
          `The backup is from a newer Printrio (${manifest.version}). Update Printrio first, then restore.`,
          409,
        );
      // Only what a backup is made of leaves the archive; anything else in it is ignored.
      const data = DATA_ENTRIES.filter((entry) => manifest.data.includes(entry) && top.has(entry));
      const tmp = await mkdtemp(join(this.dir, ".restore-"));
      try {
        await run("tar", [
          "-xzf",
          file,
          "-C",
          tmp,
          "--no-same-owner",
          "--no-same-permissions",
          "--",
          "manifest.json",
          "database.sql",
          ...data,
        ]);
        await this.assertPlainTree(join(tmp, "database.sql"), false);
        for (const entry of data) await this.assertPlainTree(join(tmp, entry), entry === "files");
        const schemas = await this.options.db.execute<{ name: string }>(
          sql`select nspname as name from pg_namespace where nspname not like 'pg\\_%' and nspname <> 'information_schema'`,
        );
        const drop = schemas
          .map((row) => `DROP SCHEMA IF EXISTS "${row.name.replace(/"/g, '""')}" CASCADE;`)
          .join("\n");
        // pg_dump 17 writes a setting older servers do not know; it is not needed for the restore.
        const dump = withoutOwnRestriction(
          (await readFile(join(tmp, "database.sql"), "utf8")).replace(
            /^SET transaction_timeout = .*$/m,
            "",
          ),
        );
        // The dump is data, not a script to trust: psql runs it in restricted mode,
        // where backslash commands (\!, \copy … program, \i, \o, …) are refused. Only
        // \unrestrict with this one-time key, which the dump cannot know, would end it.
        const key = randomBytes(32).toString("hex");
        const script = `\\restrict ${key}\n${drop}\nCREATE SCHEMA public;\n${dump}`;
        await writeFile(join(tmp, "restore.sql"), script);
        // …and as a role without special rights when Printrio's own role is a
        // superuser (the bundled PostgreSQL): the SQL of a backup then cannot reach
        // the server's files or programs (COPY … PROGRAM, server-side files, roles).
        const restricted = await this.restrictedRole(schemas.map((row) => row.name));
        try {
          await run("psql", [
            "--quiet",
            "--no-psqlrc",
            "--single-transaction",
            "-v",
            "ON_ERROR_STOP=1",
            `--file=${join(tmp, "restore.sql")}`,
            restricted?.url ?? this.options.databaseUrl,
          ]);
        } catch (error) {
          const message = String((error as { stderr?: unknown }).stderr ?? error);
          if (/backslash commands are restricted|\\unrestrict: wrong key/i.test(message))
            throw new BackupError(
              "This backup contains commands a Printrio backup never has and was not restored.",
            );
          if (/invalid command \\restrict/i.test(message))
            throw new BackupError(
              "The installed psql is too old to restore backups safely. Update the Printrio image (PostgreSQL client 17.6 or 16.10 and newer).",
              503,
            );
          if (
            restricted &&
            /permission denied|must be superuser|must be owner|must be member|only roles with/i.test(
              message,
            )
          )
            throw new BackupError(
              "This backup needs database rights a Printrio backup never needs and was not restored.",
            );
          throw error;
        } finally {
          await restricted?.release();
        }
        for (const entry of data)
          await cp(join(tmp, entry), join(this.options.dataDir, entry), {
            recursive: true,
            force: true,
          });
        this.options.log.warn(`Backup ${name} restored; restarting.`);
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    }
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

// ----- Encrypted backups ------------------------------------------------------------
// File: MAGIC, 16 bytes salt, 12 bytes IV, AES-256-GCM ciphertext, 16 bytes tag.
// The key is scrypt(passphrase, salt).

const MAGIC = Buffer.from("PRINTRIO-BACKUP-ENC1\n");
const HEADER = MAGIC.length + 16 + 12;
const TAG = 16;

const deriveKey = (passphrase: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(passphrase, salt, 32, (error, key) => (error ? reject(error) : resolve(key))),
  );

export async function isEncrypted(file: string) {
  const handle = await open(file, "r");
  try {
    const head = Buffer.alloc(MAGIC.length);
    const { bytesRead } = await handle.read(head, 0, MAGIC.length, 0);
    return bytesRead === MAGIC.length && head.equals(MAGIC);
  } finally {
    await handle.close();
  }
}

export async function encryptFile(source: string, target: string, passphrase: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await deriveKey(passphrase, salt), iv);
  const out = createWriteStream(target, { mode: 0o600 });
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(createReadStream(source), cipher, out, { end: false });
  await new Promise<void>((resolve, reject) =>
    out.end(cipher.getAuthTag(), (error?: Error | null) => (error ? reject(error) : resolve())),
  );
}

/** Throws when the passphrase is wrong or the file was changed (the target is then incomplete). */
export async function decryptFile(source: string, target: string, passphrase: string) {
  const { size } = await stat(source);
  if (size < HEADER + TAG) throw new Error("Not an encrypted backup.");
  const handle = await open(source, "r");
  let head: Buffer;
  let tag: Buffer;
  try {
    head = Buffer.alloc(HEADER);
    await handle.read(head, 0, HEADER, 0);
    tag = Buffer.alloc(TAG);
    await handle.read(tag, 0, TAG, size - TAG);
  } finally {
    await handle.close();
  }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not an encrypted backup.");
  const salt = head.subarray(MAGIC.length, MAGIC.length + 16);
  const iv = head.subarray(MAGIC.length + 16);
  const decipher = createDecipheriv("aes-256-gcm", await deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  await pipeline(
    createReadStream(source, { start: HEADER, end: size - TAG - 1 }),
    decipher,
    createWriteStream(target, { mode: 0o600 }),
  );
}

/**
 * pg_dump (16.10 / 17.6 and newer) wraps its output in \restrict <key> … \unrestrict <key>.
 * The restore sets its own restriction, inside which those two lines would be
 * refused, so exactly these are dropped: a \restrict line in the header (before
 * any table data) and an \unrestrict line that is the last line. Lines that
 * merely look alike inside table data are left untouched.
 */
export function withoutOwnRestriction(dump: string) {
  const lines = dump.split("\n");
  const firstData = lines.findIndex((line) => line.startsWith("COPY ") || line === "\\.");
  const header = firstData === -1 ? lines.length : firstData;
  const open = lines.findIndex(
    (line, index) => index < header && /^\\restrict [A-Za-z0-9]+$/.test(line),
  );
  if (open !== -1) lines.splice(open, 1);
  // pg_dump ends with it: the last line that is not empty.
  let last = lines.length - 1;
  while (last >= 0 && lines[last] === "") last--;
  if (last >= 0 && /^\\unrestrict [A-Za-z0-9]+$/.test(lines[last] as string)) lines.splice(last, 1);
  return lines.join("\n");
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
