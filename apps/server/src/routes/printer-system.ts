import { Readable } from "node:stream";
import {
  gcodePathSchema,
  type LogFileDto,
  type LogTailDto,
  type PowerDeviceDto,
  powerRequestSchema,
  type SystemInfoDto,
} from "@printrio/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { type PrinterManager, PrinterNotConnectedError } from "../printers/manager.ts";
import { parseOr400, requireAdmin, requireUser } from "./guards.ts";

const idParams = z.object({ id: z.uuid() });
/** The log viewer shows the end of a log; the full file is a download. */
export const LOG_TAIL_BYTES = 256 * 1024;
const BUSY_STATES = new Set(["printing", "paused"]);

/** Keeps the last `limit` bytes of a stream. */
export async function tail(body: AsyncIterable<Uint8Array>, limit: number) {
  let kept = Buffer.alloc(0);
  let dropped = false;
  for await (const chunk of body) {
    kept = Buffer.concat([kept, chunk]);
    if (kept.length > limit) {
      kept = kept.subarray(kept.length - limit);
      dropped = true;
    }
  }
  return { bytes: kept, dropped };
}

/** Host information, logs and power devices of a printer. */
export function printerSystemRoutes(app: FastifyInstance, manager: PrinterManager) {
  const failed = (reply: FastifyReply, error: unknown) => {
    if (error instanceof PrinterNotConnectedError)
      return reply.code(409).send({ error: error.message });
    return reply
      .code(502)
      .send({ error: error instanceof Error ? error.message : "The printer did not answer." });
  };

  app.get("/api/printers/:id/system", { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    try {
      const driver = manager.connected(params.id);
      const [info, stats] = await Promise.all([driver.getSystemInfo(), driver.getSystemStats()]);
      const body: SystemInfoDto = { info, stats };
      return body;
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.get("/api/printers/:id/logs", { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    try {
      const logs = await manager.connected(params.id).listLogs();
      return {
        logs: logs.map((log): LogFileDto => ({ ...log, modified: log.modified.toISOString() })),
      };
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.get("/api/printers/:id/logs/file", { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const query =
      params &&
      parseOr400(
        reply,
        z
          .object({ name: gcodePathSchema, download: z.enum(["0", "1"]).default("0") })
          .safeParse(request.query),
      );
    if (!params || !query) return;
    try {
      const driver = manager.connected(params.id);
      if (!(await driver.listLogs()).some((log) => log.name === query.name))
        return reply.code(404).send({ error: "Log not found." });
      if (query.download === "1") {
        const { body } = await driver.readLog(query.name);
        const fileName = query.name.slice(query.name.lastIndexOf("/") + 1).replace(/"/g, "");
        reply
          .header("Content-Type", "text/plain; charset=utf-8")
          .header("Content-Disposition", `attachment; filename="${fileName}"`)
          .header("X-Content-Type-Options", "nosniff");
        return reply.send(Readable.from(body));
      }
      const { partial, body } = await driver.readLog(query.name, LOG_TAIL_BYTES);
      const { bytes, dropped } = await tail(body, LOG_TAIL_BYTES);
      const truncated = partial || dropped;
      let content = bytes.toString("utf8");
      // Starting mid-file: drop the partial first line.
      if (truncated) content = content.slice(content.indexOf("\n") + 1);
      const result: LogTailDto = { name: query.name, content, truncated };
      return result;
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.get("/api/printers/:id/power", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    try {
      const devices: PowerDeviceDto[] = await manager.connected(params.id).listPowerDevices();
      return { devices };
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.post("/api/printers/:id/power", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const body = params && parseOr400(reply, powerRequestSchema.safeParse(request.body));
    if (!params || !body) return;
    try {
      const driver = manager.connected(params.id);
      const device = (await driver.listPowerDevices()).find((d) => d.name === body.device);
      if (!device) return reply.code(404).send({ error: "Power device not found." });
      if (device.lockedWhilePrinting && BUSY_STATES.has(manager.getStatus(params.id).state))
        return reply.code(409).send({ error: "This device is locked while the printer prints." });
      await driver.setPowerDevice(body.device, body.on);
      return { ok: true };
    } catch (error) {
      return failed(reply, error);
    }
  });
}
