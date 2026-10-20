import { type BedMeshDto, bedMeshActionSchema } from "@printrio/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { type PrinterManager, PrinterNotConnectedError } from "../printers/manager.ts";
import { parseOr400, requireUser } from "./guards.ts";

const idParams = z.object({ id: z.uuid() });
const BUSY_STATES = new Set(["printing", "paused"]);

/**
 * Bed mesh: view, calibrate, load and clear for every user; saving or removing
 * a profile writes printer.cfg (SAVE_CONFIG restarts Klipper), so admins only.
 */
export function printerMeshRoutes(
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

  app.get("/api/printers/:id/bed-mesh", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    try {
      const mesh: BedMeshDto | null = await manager.connected(params.id).getBedMesh();
      return { mesh };
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.post("/api/printers/:id/bed-mesh", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const action = params && parseOr400(reply, bedMeshActionSchema.safeParse(request.body));
    if (!params || !action) return;
    if ((action.op === "save" || action.op === "remove") && request.user?.role !== "admin")
      return reply.code(403).send({ error: "Only administrators can do this." });
    if (!(await isWithinLimit(params.id)))
      return reply.code(403).send({
        error: "This printer is outside your plan's printer limit.",
        code: "printer_limit",
      });
    if (BUSY_STATES.has(manager.getStatus(params.id).state))
      return reply.code(409).send({ error: "The printer is printing." });
    try {
      await manager.connected(params.id).bedMesh(action);
      return { ok: true };
    } catch (error) {
      return failed(reply, error);
    }
  });
}
