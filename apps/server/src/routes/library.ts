import { createReadStream } from "node:fs";
import {
  type LibraryFileDto,
  type LibraryListingDto,
  libraryDirectoryQuerySchema,
  libraryFolderSchema,
  libraryPathQuerySchema,
  librarySendSchema,
} from "@printrio/shared";
import { inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Database } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { sendToPrinter } from "../library/send.ts";
import { type Library, type LibraryEntry, LibraryPathError } from "../library/store.ts";
import { type PrinterManager, PrinterNotConnectedError } from "../printers/manager.ts";
import { parseOr400, requireAdmin, requireUser } from "./guards.ts";
import { GCODE_FILE } from "./printer-files.ts";

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * The G-code library: upload once, keep in Printrio's volume, send or print on
 * any printer. Independent of the files stored on each printer.
 */
export function libraryRoutes(
  app: FastifyInstance,
  db: Database,
  library: Library,
  manager: PrinterManager,
  isWithinLimit: (printerId: string) => Promise<boolean>,
) {
  const failed = (reply: FastifyReply, error: unknown) => {
    if (error instanceof LibraryPathError) return reply.code(400).send({ error: error.message });
    if (error instanceof PrinterNotConnectedError)
      return reply.code(409).send({ error: error.message });
    return reply
      .code(502)
      .send({ error: error instanceof Error ? error.message : "The printer did not answer." });
  };

  const toDtos = async (entries: LibraryEntry[]): Promise<LibraryFileDto[]> => {
    const ids = [...new Set(entries.map((e) => e.uploadedBy).filter((id): id is string => !!id))];
    const names = ids.length
      ? new Map(
          (
            await db
              .select({ id: users.id, name: users.displayName })
              .from(users)
              .where(inArray(users.id, ids))
          ).map((row) => [row.id, row.name]),
        )
      : new Map<string, string>();
    return entries.map((entry) => ({
      path: entry.path,
      name: fileName(entry.path),
      size: entry.size,
      modified: entry.modified.toISOString(),
      slicer: entry.slicer,
      estimatedSeconds: entry.estimatedSeconds,
      filamentMm: entry.filamentMm,
      filamentGrams: entry.filamentGrams,
      layerHeight: entry.layerHeight,
      objectHeight: entry.objectHeight,
      material: entry.material,
      hasThumbnail: entry.thumbnail !== null,
      uploadedBy: entry.uploadedBy ? (names.get(entry.uploadedBy) ?? null) : null,
    }));
  };

  app.get("/api/library", { preHandler: requireUser }, async (request, reply) => {
    const query = parseOr400(reply, libraryDirectoryQuerySchema.safeParse(request.query));
    if (!query) return;
    try {
      const listing = await library.list(query.dir);
      const body: LibraryListingDto = {
        directory: query.dir,
        directories: listing.directories,
        files: await toDtos(listing.files),
      };
      return body;
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.post("/api/library", { preHandler: requireUser }, async (request, reply) => {
    const query = parseOr400(reply, libraryDirectoryQuerySchema.safeParse(request.query));
    if (!query) return;
    const upload = await request.file();
    if (!upload) return reply.code(400).send({ error: "Choose a file to upload." });
    if (!GCODE_FILE.test(upload.filename) || upload.filename.toLowerCase().endsWith(".ufp")) {
      upload.file.resume();
      return reply
        .code(400)
        .send({ error: "Only G-code files (.gcode, .g, .gco) can be uploaded." });
    }
    const path = query.dir ? `${query.dir}/${upload.filename}` : upload.filename;
    try {
      const entry = await library.save(path, upload.file, request.user?.id ?? null);
      if (upload.file.truncated) {
        await library.remove(path);
        return reply.code(413).send({ error: "The file is too large." });
      }
      const [dto] = entry ? await toDtos([entry]) : [];
      return reply.code(201).send(dto);
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.post("/api/library/folders", { preHandler: requireUser }, async (request, reply) => {
    const body = parseOr400(reply, libraryFolderSchema.safeParse(request.body));
    if (!body) return;
    try {
      await library.createFolder(body.path);
      return reply.code(201).send({ path: body.path });
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.delete("/api/library", { preHandler: requireAdmin }, async (request, reply) => {
    const query = parseOr400(reply, libraryPathQuerySchema.safeParse(request.query));
    if (!query) return;
    try {
      if (!(await library.remove(query.path))) return reply.code(404).send({ error: "Not found." });
      return reply.code(204).send();
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.get("/api/library/thumbnail", { preHandler: requireUser }, async (request, reply) => {
    const query = parseOr400(reply, libraryPathQuerySchema.safeParse(request.query));
    if (!query) return;
    try {
      const entry = await library.index(query.path);
      if (!entry?.thumbnail) return reply.code(404).send({ error: "No thumbnail." });
      return reply
        .header("Content-Type", entry.thumbnailFormat === "jpg" ? "image/jpeg" : "image/png")
        .header("Cache-Control", "private, max-age=300")
        .send(Buffer.from(entry.thumbnail, "base64"));
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.get("/api/library/download", { preHandler: requireUser }, async (request, reply) => {
    const query = parseOr400(reply, libraryPathQuerySchema.safeParse(request.query));
    if (!query) return;
    try {
      const entry = await library.index(query.path);
      if (!entry) return reply.code(404).send({ error: "File not found." });
      return reply
        .header("Content-Type", "text/x-gcode")
        .header(
          "Content-Disposition",
          `attachment; filename="${fileName(entry.path).replace(/"/g, "")}"`,
        )
        .header("Content-Length", entry.size)
        .send(createReadStream(library.resolvePath(entry.path)));
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.post("/api/library/send", { preHandler: requireUser }, async (request, reply) => {
    const body = parseOr400(reply, librarySendSchema.safeParse(request.body));
    if (!body) return;
    if (body.print) {
      if (!(await isWithinLimit(body.printerId)))
        return reply.code(403).send({
          error: "This printer is outside your plan's printer limit.",
          code: "printer_limit",
        });
      if (manager.getStatus(body.printerId).state !== "idle")
        return reply
          .code(409)
          .send({ error: "The printer is busy; send the file without printing." });
    }
    try {
      const entry = await library.index(body.path);
      if (!entry) return reply.code(404).send({ error: "File not found." });
      const target = await sendToPrinter(
        library,
        manager.connected(body.printerId),
        entry.path,
        body.print,
      );
      return { path: target, printing: body.print };
    } catch (error) {
      return failed(reply, error);
    }
  });
}
