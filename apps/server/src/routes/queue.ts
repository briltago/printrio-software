import { type QueueItemDto, queueAddSchema, queueReorderSchema } from "@printrio/shared";
import { and, asc, eq, inArray, max } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.ts";
import { orders, queueItems, users } from "../db/schema.ts";
import type { JobRecorder } from "../jobs/recorder.ts";
import { type PrinterManager, PrinterNotConnectedError } from "../printers/manager.ts";
import { parseOr400, requireUser } from "./guards.ts";

const idParams = z.object({ id: z.uuid() });
const itemParams = z.object({ id: z.uuid(), itemId: z.uuid() });

/**
 * Per-printer print queue (Free). Prints are started by hand with "start next":
 * someone has to clear the bed between prints. Fleet queues, automatic
 * assignment and matching are Pro.
 */
export function queueRoutes(
  app: FastifyInstance,
  db: Database,
  manager: PrinterManager,
  recorder: JobRecorder,
  isWithinLimit: (printerId: string) => Promise<boolean>,
  onChange: () => void,
) {
  const list = async (printerId: string): Promise<QueueItemDto[]> => {
    const rows = await db
      .select({ item: queueItems, orderName: orders.name, addedBy: users.displayName })
      .from(queueItems)
      .leftJoin(orders, eq(orders.id, queueItems.orderId))
      .leftJoin(users, eq(users.id, queueItems.addedBy))
      .where(eq(queueItems.printerId, printerId))
      .orderBy(asc(queueItems.position), asc(queueItems.createdAt));
    return rows.map(({ item, orderName, addedBy }) => ({
      id: item.id,
      path: item.path,
      orderId: item.orderId,
      orderName,
      addedBy,
      createdAt: item.createdAt.toISOString(),
    }));
  };

  app.get("/api/printers/:id/queue", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    return { items: await list(params.id) };
  });

  app.post("/api/printers/:id/queue", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const body = params && parseOr400(reply, queueAddSchema.safeParse(request.body));
    if (!params || !body) return;
    if (body.orderId) {
      const [order] = await db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.id, body.orderId));
      if (!order) return reply.code(400).send({ error: "Choose an existing order." });
    }
    try {
      await db.transaction(async (tx) => {
        const [last] = await tx
          .select({ position: max(queueItems.position) })
          .from(queueItems)
          .where(eq(queueItems.printerId, params.id));
        const start = (last?.position ?? -1) + 1;
        await tx.insert(queueItems).values(
          Array.from({ length: body.copies }, (_, index) => ({
            printerId: params.id,
            path: body.path,
            position: start + index,
            orderId: body.orderId ?? null,
            addedBy: request.user?.id ?? null,
          })),
        );
      });
    } catch {
      return reply.code(404).send({ error: "Printer not found." });
    }
    onChange();
    return reply.code(201).send({ items: await list(params.id) });
  });

  app.delete(
    "/api/printers/:id/queue/:itemId",
    { preHandler: requireUser },
    async (request, reply) => {
      const params = parseOr400(reply, itemParams.safeParse(request.params));
      if (!params) return;
      const deleted = await db
        .delete(queueItems)
        .where(and(eq(queueItems.id, params.itemId), eq(queueItems.printerId, params.id)))
        .returning();
      if (deleted.length === 0) return reply.code(404).send({ error: "Queue item not found." });
      onChange();
      return reply.code(204).send();
    },
  );

  app.put("/api/printers/:id/queue/order", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const body = params && parseOr400(reply, queueReorderSchema.safeParse(request.body));
    if (!params || !body) return;
    const current = await db
      .select({ id: queueItems.id })
      .from(queueItems)
      .where(eq(queueItems.printerId, params.id));
    const known = new Set(current.map((row) => row.id));
    if (body.ids.length !== known.size || !body.ids.every((id) => known.has(id)))
      return reply.code(400).send({ error: "List every queued item exactly once." });
    await db.transaction(async (tx) => {
      for (const [position, id] of body.ids.entries())
        await tx.update(queueItems).set({ position }).where(eq(queueItems.id, id));
    });
    onChange();
    return { items: await list(params.id) };
  });

  app.post("/api/printers/:id/queue/start", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    if (!(await isWithinLimit(params.id)))
      return reply.code(403).send({
        error: "This printer is outside your plan's printer limit.",
        code: "printer_limit",
      });
    if (manager.getStatus(params.id).state !== "idle")
      return reply.code(409).send({ error: "The printer is not ready for the next print." });
    const [next] = await db
      .select()
      .from(queueItems)
      .where(eq(queueItems.printerId, params.id))
      .orderBy(asc(queueItems.position), asc(queueItems.createdAt))
      .limit(1);
    if (!next) return reply.code(409).send({ error: "The queue is empty." });
    try {
      recorder.expectOrder(params.id, next.path, next.orderId);
      await manager.connected(params.id).startPrint(next.path);
    } catch (error) {
      recorder.expectOrder(params.id, next.path, null);
      if (error instanceof PrinterNotConnectedError)
        return reply.code(409).send({ error: error.message });
      return reply
        .code(502)
        .send({ error: error instanceof Error ? error.message : "The print did not start." });
    }
    await db.delete(queueItems).where(inArray(queueItems.id, [next.id]));
    onChange();
    return { started: next.path, items: await list(params.id) };
  });
}
