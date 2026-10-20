import { gcodeDirectorySchema } from "@printrio/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { findApiKeyUser } from "../auth/api-keys.ts";
import type { Database } from "../db/client.ts";
import type { JobRecorder } from "../jobs/recorder.ts";
import { printerFileName, sendToPrinter } from "../library/send.ts";
import type { Library } from "../library/store.ts";
import type { PrinterManager } from "../printers/manager.ts";
import { GCODE_FILE } from "./printer-files.ts";
import { enqueue } from "./queue.ts";

const targetParams = z.object({ target: z.union([z.literal("library"), z.uuid()]) });

/**
 * A small OctoPrint-compatible API so slicers (PrusaSlicer, SuperSlicer,
 * OrcaSlicer, Bambu Studio: physical printer of type "OctoPrint") can upload
 * straight into Printrio. The slicer's host is
 *   http://<printrio>/octoprint/library      → the G-code library
 *   http://<printrio>/octoprint/<printer id> → library + that printer
 * Authentication: a personal API key (X-Api-Key header or `apikey` query).
 */
export function octoprintRoutes(
  app: FastifyInstance,
  db: Database,
  library: Library,
  manager: PrinterManager,
  recorder: JobRecorder,
  printerExists: (printerId: string) => Promise<boolean>,
  isWithinLimit: (printerId: string) => Promise<boolean>,
  onQueueChange: () => void,
) {
  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers["x-api-key"];
    const query = (request.query as { apikey?: string } | undefined)?.apikey;
    const key = (Array.isArray(header) ? header[0] : header) ?? query;
    const user = key ? await findApiKeyUser(db, key) : null;
    if (!user) return reply.code(401).send({ error: "Invalid or missing API key." });
    request.user = user;
  };
  const target = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = targetParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "Unknown upload target." });
    if (params.data.target !== "library" && !(await printerExists(params.data.target)))
      return reply.code(404).send({ error: "Unknown printer." });
    return params.data.target;
  };

  app.get(
    "/octoprint/:target/api/version",
    { preHandler: authenticate },
    async (request, reply) => {
      if (!(await target(request, reply))) return;
      // Slicers check that `text` mentions OctoPrint.
      return { api: "0.1", server: "1.10.0", text: "OctoPrint 1.10.0 (Printrio)" };
    },
  );

  app.get("/octoprint/:target/api/server", { preHandler: authenticate }, async (request, reply) => {
    if (!(await target(request, reply))) return;
    return { server: "1.10.0", safemode: null };
  });

  app.post(
    "/octoprint/:target/api/files/local",
    { preHandler: authenticate },
    async (request, reply) => {
      const destination = await target(request, reply);
      if (!destination) return;
      const upload = await request.file();
      if (!upload) return reply.code(400).send({ error: "No file." });
      if (!GCODE_FILE.test(upload.filename) || upload.filename.toLowerCase().endsWith(".ufp")) {
        upload.file.resume();
        return reply.code(415).send({ error: "Only G-code files can be uploaded." });
      }
      // OctoPrint form fields sent before the file: path (folder), print, select.
      const field = (name: string) => {
        const value = upload.fields[name];
        const single = Array.isArray(value) ? value[0] : value;
        return single && "value" in single ? String(single.value) : undefined;
      };
      const folder = gcodeDirectorySchema.safeParse(field("path")?.replace(/^\/+|\/+$/g, "") ?? "");
      const directory = folder.success ? folder.data : "";
      const path = directory ? `${directory}/${upload.filename}` : upload.filename;
      const entry = await library.save(path, upload.file, request.user?.id ?? null);
      if (upload.file.truncated || !entry) {
        await library.remove(path);
        return reply.code(413).send({ error: "The file is too large." });
      }

      let printing = false;
      if (destination !== "library") {
        const wantsPrint = field("print") === "true";
        const ready =
          manager.getStatus(destination).state === "idle" && (await isWithinLimit(destination));
        try {
          if (wantsPrint && ready) {
            await sendToPrinter(library, manager.connected(destination), path, true);
            printing = true;
          } else if (wantsPrint) {
            // Busy: queue it instead of interrupting anything.
            await enqueue(db, {
              printerId: destination,
              path,
              source: "library",
              orderId: null,
              addedBy: request.user?.id ?? null,
              copies: 1,
            });
            onQueueChange();
          } else {
            await sendToPrinter(library, manager.connected(destination), path, false);
          }
        } catch (error) {
          return reply.code(409).send({
            error: error instanceof Error ? error.message : "The printer did not accept the file.",
          });
        }
        if (printing) recorder.expectOrder(destination, printerFileName(path), null);
      }
      return reply.code(201).send({
        done: true,
        files: {
          local: {
            name: upload.filename,
            path,
            origin: "local",
            refs: { resource: `/api/library/download?path=${encodeURIComponent(path)}` },
          },
        },
        effectivePrint: printing,
        effectiveSelect: printing,
      });
    },
  );
}
