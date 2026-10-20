import {
  jobOrderSchema,
  type OrderDetailDto,
  type OrderDto,
  orderInputSchema,
  orderListQuerySchema,
  orderUpdateSchema,
} from "@printrio/shared";
import { desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.ts";
import { orders, printJobs } from "../db/schema.ts";
import { getWorkspaceSettings } from "../settings.ts";
import { parseOr400, requireAdmin, requireUser } from "./guards.ts";
import { toJobRecord } from "./jobs.ts";

const idParams = z.object({ id: z.uuid() });

/**
 * Simple orders (Free): name, customer as text, status and linked prints, with
 * the summed print cost. Line items, prices, deadlines and scheduling are Pro.
 */
export function orderRoutes(app: FastifyInstance, db: Database, onJobsChange: () => void) {
  const listOrders = async (where?: ReturnType<typeof eq>) => {
    const settings = await getWorkspaceSettings(db);
    const rows = await db
      .select({
        order: orders,
        jobCount: sql<number>`count(${printJobs.id})`,
        totalCost: sql<number>`coalesce(sum(${printJobs.totalCost}), 0)`,
      })
      .from(orders)
      .leftJoin(printJobs, eq(printJobs.orderId, orders.id))
      .where(where)
      .groupBy(orders.id)
      .orderBy(desc(orders.createdAt));
    return rows.map(
      ({ order, jobCount, totalCost }): OrderDto => ({
        id: order.id,
        name: order.name,
        customer: order.customer,
        status: order.status as OrderDto["status"],
        notes: order.notes,
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
        jobCount: Number(jobCount),
        totalCost: Number(totalCost),
        currency: settings.costs.currency,
      }),
    );
  };

  app.get("/api/orders", { preHandler: requireUser }, async (request, reply) => {
    const query = parseOr400(reply, orderListQuerySchema.safeParse(request.query));
    if (!query) return;
    return { orders: await listOrders(query.status ? eq(orders.status, query.status) : undefined) };
  });

  app.get("/api/orders/:id", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    const [order] = await listOrders(eq(orders.id, params.id));
    if (!order) return reply.code(404).send({ error: "Order not found." });
    const jobs = await db
      .select()
      .from(printJobs)
      .where(eq(printJobs.orderId, params.id))
      .orderBy(desc(printJobs.startedAt));
    const body: OrderDetailDto = { ...order, jobs: jobs.map(toJobRecord) };
    return body;
  });

  app.post("/api/orders", { preHandler: requireUser }, async (request, reply) => {
    const input = parseOr400(reply, orderInputSchema.safeParse(request.body));
    if (!input) return;
    const [row] = await db
      .insert(orders)
      .values({
        name: input.name,
        customer: input.customer ?? null,
        status: input.status,
        notes: input.notes ?? null,
      })
      .returning({ id: orders.id });
    return reply.code(201).send(row);
  });

  app.patch("/api/orders/:id", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const input = params && parseOr400(reply, orderUpdateSchema.safeParse(request.body));
    if (!params || !input) return;
    // Partial updates: the schema defaults `status`, so take only fields the client sent.
    const sent = request.body as Record<string, unknown>;
    const changes: Partial<typeof orders.$inferInsert> = { updatedAt: new Date() };
    if ("name" in sent && input.name !== undefined) changes.name = input.name;
    if ("customer" in sent) changes.customer = input.customer ?? null;
    if ("status" in sent && input.status) changes.status = input.status;
    if ("notes" in sent) changes.notes = input.notes ?? null;
    const updated = await db
      .update(orders)
      .set(changes)
      .where(eq(orders.id, params.id))
      .returning({ id: orders.id });
    if (updated.length === 0) return reply.code(404).send({ error: "Order not found." });
    return { ok: true };
  });

  app.delete("/api/orders/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    // Linked prints stay in the history (order_id is set to null).
    const deleted = await db.delete(orders).where(eq(orders.id, params.id)).returning();
    if (deleted.length === 0) return reply.code(404).send({ error: "Order not found." });
    onJobsChange();
    return reply.code(204).send();
  });

  app.put("/api/jobs/:id/order", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const body = params && parseOr400(reply, jobOrderSchema.safeParse(request.body));
    if (!params || !body) return;
    if (body.orderId) {
      const [order] = await db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.id, body.orderId));
      if (!order) return reply.code(400).send({ error: "Choose an existing order." });
    }
    const updated = await db
      .update(printJobs)
      .set({ orderId: body.orderId })
      .where(eq(printJobs.id, params.id))
      .returning({ id: printJobs.id });
    if (updated.length === 0) return reply.code(404).send({ error: "Print not found." });
    onJobsChange();
    return { ok: true };
  });
}
