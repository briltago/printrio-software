import { type UpdateStatusDto, updateActionSchema } from "@printrio/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { type PrinterManager, PrinterNotConnectedError } from "../printers/manager.ts";
import { parseOr400, requireAdmin } from "./guards.ts";

const idParams = z.object({ id: z.uuid() });
const BUSY_STATES = new Set(["printing", "paused"]);

/**
 * Software updates of the printer host (Moonraker's update manager), admin-only.
 * Progress is pushed as `printer.update` realtime messages while a request runs.
 */
export function printerUpdateRoutes(app: FastifyInstance, manager: PrinterManager) {
  const failed = (reply: FastifyReply, error: unknown) => {
    if (error instanceof PrinterNotConnectedError)
      return reply.code(409).send({ error: error.message });
    return reply
      .code(502)
      .send({ error: error instanceof Error ? error.message : "The printer did not answer." });
  };

  app.get("/api/printers/:id/updates", { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    try {
      const status = await manager.connected(params.id).getUpdateStatus();
      const body: UpdateStatusDto = {
        busy: status.busy,
        components: status.components.map((component) => ({
          ...component,
          commitsBehind: component.commitsBehind.map((commit) => ({
            ...commit,
            date: commit.date?.toISOString() ?? null,
          })),
        })),
      };
      return body;
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.post("/api/printers/:id/updates", { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const action = params && parseOr400(reply, updateActionSchema.safeParse(request.body));
    if (!params || !action) return;
    if (action.op !== "refresh" && BUSY_STATES.has(manager.getStatus(params.id).state))
      return reply.code(409).send({ error: "The printer is printing. Update after the print." });
    try {
      await manager.connected(params.id).updateSoftware(action);
      return { ok: true };
    } catch (error) {
      return failed(reply, error);
    }
  });
}
