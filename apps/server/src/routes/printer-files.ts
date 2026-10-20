import { Readable } from "node:stream";
import {
  type FileListingDto,
  gcodeDirectorySchema,
  gcodePathSchema,
  type JobHistoryDto,
} from "@printrio/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { type PrinterManager, PrinterNotConnectedError } from "../printers/manager.ts";
import { parseOr400, requireUser } from "./guards.ts";

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what file names must not contain.
export const GCODE_FILE = /^[^/\\\u0000-\u001f]+\.(gcode|g|gco|ufp)$/i;
const IMAGE_FILE = /\.(png|jpe?g|webp)$/i;
const idParams = z.object({ id: z.uuid() });

/** Files on the printer (G-code root), thumbnails, uploads and print history. */
export function printerFileRoutes(
  app: FastifyInstance,
  manager: PrinterManager,
  isWithinLimit: (printerId: string) => Promise<boolean>,
) {
  const failed = (reply: FastifyReply, error: unknown) => {
    if (error instanceof PrinterNotConnectedError)
      return reply.code(409).send({ error: error.message });
    return reply
      .code(502)
      .send({ error: error instanceof Error ? error.message : "The printer did not answer." });
  };

  app.get("/api/printers/:id/files", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const query =
      params &&
      parseOr400(
        reply,
        z.object({ dir: gcodeDirectorySchema.default("") }).safeParse(request.query),
      );
    if (!params || !query) return;
    try {
      const listing = await manager.connected(params.id).listFiles(query.dir);
      const body: FileListingDto = {
        directory: query.dir,
        directories: listing.directories,
        files: listing.files.map(({ thumbnailPath, modified, ...file }) => ({
          ...file,
          name: file.path.slice(file.path.lastIndexOf("/") + 1),
          modified: modified.toISOString(),
          hasThumbnail: thumbnailPath !== null,
        })),
      };
      return body;
    } catch (error) {
      return failed(reply, error);
    }
  });

  // Thumbnails are looked up by the G-code file they belong to, so clients never pick arbitrary paths.
  app.get(
    "/api/printers/:id/files/thumbnail",
    { preHandler: requireUser },
    async (request, reply) => {
      const params = parseOr400(reply, idParams.safeParse(request.params));
      const query =
        params && parseOr400(reply, z.object({ path: gcodePathSchema }).safeParse(request.query));
      if (!params || !query) return;
      try {
        const driver = manager.connected(params.id);
        const directory = query.path.includes("/")
          ? query.path.slice(0, query.path.lastIndexOf("/"))
          : "";
        const file = (await driver.listFiles(directory)).files.find((f) => f.path === query.path);
        const thumbnail = file?.thumbnailPath;
        if (!thumbnail || !IMAGE_FILE.test(thumbnail))
          return reply.code(404).send({ error: "No thumbnail." });
        const { contentType, body } = await driver.readFile(thumbnail);
        return reply
          .header("Content-Type", contentType)
          .header("Cache-Control", "private, max-age=300")
          .header("X-Content-Type-Options", "nosniff")
          .send(Readable.from(body));
      } catch (error) {
        return failed(reply, error);
      }
    },
  );

  app.post("/api/printers/:id/files", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const query =
      params &&
      parseOr400(
        reply,
        z
          .object({
            dir: gcodeDirectorySchema.default(""),
            print: z.enum(["true", "false"]).default("false"),
          })
          .safeParse(request.query),
      );
    if (!params || !query) return;
    const upload = await request.file();
    if (!upload) return reply.code(400).send({ error: "No file uploaded." });
    if (!GCODE_FILE.test(upload.filename))
      return reply.code(400).send({ error: "Only G-code files can be uploaded." });
    const startPrint = query.print === "true";
    if (startPrint && !(await isWithinLimit(params.id))) {
      return reply.code(403).send({
        error: "This printer is outside your plan's printer limit.",
        code: "printer_limit",
      });
    }
    const path = query.dir ? `${query.dir}/${upload.filename}` : upload.filename;
    try {
      const driver = manager.connected(params.id);
      await driver.uploadFile(path, upload.file);
      if (upload.file.truncated) return reply.code(413).send({ error: "The file is too large." });
      if (startPrint) await driver.startPrint(path);
      return reply.code(201).send({ path, printing: startPrint });
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.delete("/api/printers/:id/files", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const query =
      params && parseOr400(reply, z.object({ path: gcodePathSchema }).safeParse(request.query));
    if (!params || !query) return;
    try {
      await manager.connected(params.id).deleteFile(query.path);
      return { ok: true };
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.get("/api/printers/:id/history", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const query =
      params &&
      parseOr400(
        reply,
        z
          .object({
            limit: z.coerce.number().int().min(1).max(200).default(50),
            offset: z.coerce.number().int().min(0).default(0),
          })
          .safeParse(request.query),
      );
    if (!params || !query) return;
    try {
      const { jobs, totals } = await manager
        .connected(params.id)
        .listJobs(query.limit, query.offset);
      const body: JobHistoryDto = {
        totals,
        jobs: jobs.map(({ thumbnailPath, startedAt, endedAt, ...job }) => ({
          ...job,
          startedAt: startedAt.toISOString(),
          endedAt: endedAt?.toISOString() ?? null,
          hasThumbnail: thumbnailPath !== null,
        })),
      };
      return body;
    } catch (error) {
      return failed(reply, error);
    }
  });
}
