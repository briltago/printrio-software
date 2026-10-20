import { createWriteStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, rmdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { eq, like, or } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { libraryFiles } from "../db/schema.ts";
import { parseGcodeMeta } from "./gcode-meta.ts";

const GCODE = /\.(gcode|g|gco)$/i;
const HEAD_BYTES = 1024 * 1024;
const TAIL_BYTES = 512 * 1024;

export class LibraryPathError extends Error {}

export type LibraryEntry = typeof libraryFiles.$inferSelect;

/**
 * The G-code library: files in DATA_DIR/files (a Docker volume), with slicer
 * metadata cached in the database. Files copied into the folder by hand show
 * up too; their metadata is read on first listing.
 */
export class Library {
  readonly root: string;

  constructor(
    dataDir: string,
    private db: Database,
  ) {
    this.root = resolve(dataDir, "files");
  }

  /** Absolute path for a validated relative path; refuses anything outside the root. */
  resolvePath(path: string) {
    const absolute = resolve(this.root, path);
    if (absolute !== this.root && !absolute.startsWith(this.root + sep))
      throw new LibraryPathError("Invalid path.");
    return absolute;
  }

  async list(directory: string) {
    const absolute = this.resolvePath(directory);
    await mkdir(this.root, { recursive: true });
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch {
      throw new LibraryPathError("Folder not found.");
    }
    const visible = entries.filter((entry) => !entry.name.startsWith("."));
    const prefix = directory ? `${directory}/` : "";
    const files: LibraryEntry[] = [];
    for (const entry of visible) {
      if (entry.isFile() && GCODE.test(entry.name)) {
        const indexed = await this.index(`${prefix}${entry.name}`);
        if (indexed) files.push(indexed);
      }
    }
    return {
      directories: visible
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b)),
      files,
    };
  }

  /** Metadata for one file, (re)read from the G-code when the file changed. */
  async index(path: string, uploadedBy?: string | null): Promise<LibraryEntry | null> {
    const absolute = this.resolvePath(path);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(absolute);
    } catch {
      return null;
    }
    if (!info.isFile()) return null;
    const [cached] = await this.db.select().from(libraryFiles).where(eq(libraryFiles.path, path));
    if (
      cached &&
      uploadedBy === undefined &&
      cached.size === info.size &&
      cached.modified.getTime() === Math.floor(info.mtimeMs)
    )
      return cached;

    const meta = parseGcodeMeta(...(await readEnds(absolute, info.size)));
    const values = {
      size: info.size,
      modified: new Date(Math.floor(info.mtimeMs)),
      slicer: meta.slicer,
      estimatedSeconds: meta.estimatedSeconds,
      filamentMm: meta.filamentMm,
      filamentGrams: meta.filamentGrams,
      layerHeight: meta.layerHeight,
      objectHeight: meta.objectHeight,
      material: meta.material,
      thumbnailFormat: meta.thumbnail?.format ?? null,
      thumbnail: meta.thumbnail?.data.toString("base64") ?? null,
      uploadedBy: uploadedBy === undefined ? (cached?.uploadedBy ?? null) : uploadedBy,
      indexedAt: new Date(),
    };
    const [row] = await this.db
      .insert(libraryFiles)
      .values({ path, ...values })
      .onConflictDoUpdate({ target: libraryFiles.path, set: values })
      .returning();
    return row ?? null;
  }

  /** Streams an upload to disk (via a temporary file) and indexes it. */
  async save(path: string, data: AsyncIterable<Uint8Array>, uploadedBy: string | null) {
    const absolute = this.resolvePath(path);
    await mkdir(dirname(absolute), { recursive: true });
    const temporary = join(dirname(absolute), `.upload-${process.pid}-${Date.now()}`);
    try {
      await pipeline(Readable.from(data), createWriteStream(temporary));
      await rename(temporary, absolute);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    return this.index(path, uploadedBy);
  }

  async createFolder(path: string) {
    await mkdir(this.resolvePath(path), { recursive: true });
  }

  /** Deletes a file, or a folder when it is empty. */
  async remove(path: string) {
    const absolute = this.resolvePath(path);
    if (absolute === this.root) throw new LibraryPathError("Invalid path.");
    const info = await stat(absolute).catch(() => null);
    if (!info) return false;
    if (info.isDirectory()) {
      try {
        await rmdir(absolute);
      } catch {
        throw new LibraryPathError("Only empty folders can be deleted.");
      }
      await this.db
        .delete(libraryFiles)
        .where(or(eq(libraryFiles.path, path), like(libraryFiles.path, `${path}/%`)));
      return true;
    }
    await rm(absolute);
    await this.db.delete(libraryFiles).where(eq(libraryFiles.path, path));
    return true;
  }

  /** Relative path of an absolute one inside the library (for messages and tests). */
  relative(absolute: string) {
    return relative(this.root, absolute).split(sep).join("/");
  }
}

async function readEnds(path: string, size: number): Promise<[string, string]> {
  const handle = await open(path, "r");
  try {
    const headLength = Math.min(size, HEAD_BYTES);
    const head = Buffer.alloc(headLength);
    await handle.read(head, 0, headLength, 0);
    const tailLength = Math.min(Math.max(0, size - headLength), TAIL_BYTES);
    const tail = Buffer.alloc(tailLength);
    if (tailLength > 0) await handle.read(tail, 0, tailLength, size - tailLength);
    return [head.toString("utf8"), tail.toString("utf8")];
  } finally {
    await handle.close();
  }
}
