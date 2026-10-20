import {
  jobOrderSchema,
  type OrderDetailDto,
  orderInputSchema,
  orderListQuerySchema,
  orderUpdateSchema,
} from "@printrio/shared";
import { desc, eq, isNotNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.ts";
import { orders, printJobs } from "../db/schema.ts";
import { type Library, LibraryPathError } from "../library/store.ts";
import type { OrderChanges, OrderService } from "../orders/service.ts";
import { parseOr400, requireAdmin, requireUser } from "./guards.ts";
import { toJobRecord } from "./jobs.ts";
import { libraryFileDtos } from "./library.ts";
import { GCODE_FILE } from "./printer-files.ts";

const idParams = z.object({ id: z.uuid() });

export type { OrderEvent } from "../orders/service.ts";

export interface OrderRouteOptions {
  library: Library;
  orders: OrderService;
}

/**
 * Simple orders (Free): name, customer as text, status, linked prints with the
 * summed print cost, and a folder in Files for the order's G-code. Line items,
 * prices, deadlines and scheduling are Pro.
 */
export function orderRoutes(
  app: FastifyInstance,
  db: Database,
  onJobsChange: () => void,
  { library, orders: service }: OrderRouteOptions,
) {
  const orderById = async (id: string) => (await service.get(id)) ?? undefined;

  app.get("/api/orders", { preHandler: requireUser }, async (request, reply) => {
    const query = parseOr400(reply, orderListQuerySchema.safeParse(request.query));
    if (!query) return;
    return {
      orders: await service.list(query.status ? eq(orders.status, query.status) : undefined),
    };
  });

  app.get("/api/orders/:id", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    const order = await orderById(params.id);
    if (!order) return reply.code(404).send({ error: "Order not found." });
    const jobs = await db
      .select()
      .from(printJobs)
      .where(eq(printJobs.orderId, params.id))
      .orderBy(desc(printJobs.startedAt));
    // The folder may have been renamed or removed in Files; that just means no files.
    const listing = order.folder ? await library.list(order.folder).catch(() => null) : null;
    const body: OrderDetailDto = {
      ...order,
      jobs: jobs.map(toJobRecord),
      files: listing ? await libraryFileDtos(db, listing.files) : [],
    };
    return body;
  });

  app.post("/api/orders", { preHandler: requireUser }, async (request, reply) => {
    const input = parseOr400(reply, orderInputSchema.safeParse(request.body));
    if (!input) return;
    const order = await service.create({
      name: input.name,
      customer: input.customer ?? null,
      status: input.status,
      notes: input.notes ?? null,
      folder: input.folder,
    });
    return reply.code(201).send({ id: order.id });
  });

  app.patch("/api/orders/:id", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const input = params && parseOr400(reply, orderUpdateSchema.safeParse(request.body));
    if (!params || !input) return;
    // Partial updates: the schema defaults `status`, so take only fields the client sent.
    const sent = request.body as Record<string, unknown>;
    const changes: OrderChanges = {};
    if ("name" in sent && input.name !== undefined) changes.name = input.name;
    if ("customer" in sent) changes.customer = input.customer ?? null;
    if ("status" in sent && input.status) changes.status = input.status;
    if ("notes" in sent) changes.notes = input.notes ?? null;
    if (!(await service.update(params.id, changes)))
      return reply.code(404).send({ error: "Order not found." });
    return { ok: true };
  });

  /** Customer names already used on orders, for suggestions in the order form. */
  app.get("/api/orders/customers", { preHandler: requireUser }, async () => {
    const rows = await db
      .selectDistinct({ customer: orders.customer })
      .from(orders)
      .where(isNotNull(orders.customer))
      .orderBy(orders.customer);
    return { customers: rows.map((row) => row.customer as string) };
  });

  /** Upload a G-code file into the order's folder (created on demand). */
  app.post("/api/orders/:id/files", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    const [row] = await db.select().from(orders).where(eq(orders.id, params.id));
    if (!row) return reply.code(404).send({ error: "Order not found." });
    const upload = await request.file();
    if (!upload) return reply.code(400).send({ error: "Choose a file to upload." });
    if (!GCODE_FILE.test(upload.filename) || upload.filename.toLowerCase().endsWith(".ufp")) {
      upload.file.resume();
      return reply
        .code(400)
        .send({ error: "Only G-code files (.gcode, .g, .gco) can be uploaded." });
    }
    try {
      const folder = row.folder ?? (await service.assignFolder(row));
      const path = `${folder}/${upload.filename}`;
      const entry = await library.save(path, upload.file, request.user?.id ?? null);
      if (upload.file.truncated) {
        await library.remove(path);
        return reply.code(413).send({ error: "The file is too large." });
      }
      const [dto] = entry ? await libraryFileDtos(db, [entry]) : [];
      return reply.code(201).send(dto);
    } catch (error) {
      if (error instanceof LibraryPathError) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });

  app.delete("/api/orders/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    // Linked prints stay in the history (order_id is set to null); the folder stays in Files.
    if (!(await service.remove(params.id)))
      return reply.code(404).send({ error: "Order not found." });
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
