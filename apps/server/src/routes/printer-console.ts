import type { ConsoleHistoryDto, MacroListDto } from "@printrio/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { type PrinterManager, PrinterNotConnectedError } from "../printers/manager.ts";
import { parseOr400, requireUser } from "./guards.ts";

const idParams = z.object({ id: z.uuid() });

/** Console backlog, macros and G-code commands (for autocomplete). Sending G-code goes through `/commands`. */
export function printerConsoleRoutes(app: FastifyInstance, manager: PrinterManager) {
  const failed = (reply: FastifyReply, error: unknown) => {
    if (error instanceof PrinterNotConnectedError)
      return reply.code(409).send({ error: error.message });
    return reply
      .code(502)
      .send({ error: error instanceof Error ? error.message : "The printer did not answer." });
  };

  app.get("/api/printers/:id/console", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const query =
      params &&
      parseOr400(
        reply,
        z
          .object({ count: z.coerce.number().int().min(1).max(1000).default(200) })
          .safeParse(request.query),
      );
    if (!params || !query) return;
    try {
      const entries = await manager.connected(params.id).getConsoleHistory(query.count);
      const body: ConsoleHistoryDto = {
        entries: entries.map((entry) => ({ ...entry, time: entry.time.toISOString() })),
      };
      return body;
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.get("/api/printers/:id/macros", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    try {
      const driver = manager.connected(params.id);
      const [macros, commands] = await Promise.all([
        driver.listMacros(),
        driver.listGcodeCommands(),
      ]);
      const body: MacroListDto = { macros, commands };
      return body;
    } catch (error) {
      return failed(reply, error);
    }
  });
}
