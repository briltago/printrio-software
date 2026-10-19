import type { PrinterDriverFactory } from "@printrio/sdk";
import {
  type ConnectionTestResult,
  connectionTestSchema,
  effectiveLimits,
  type Printer,
  printerCommandSchema,
  printerGroupInputSchema,
  printerInputSchema,
  printerUpdateSchema,
} from "@printrio/shared";
import { asc, count, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SecretBox } from "../crypto.ts";
import type { Database } from "../db/client.ts";
import { printerGroups, printers } from "../db/schema.ts";
import { type PrinterManager, PrinterNotConnectedError } from "../printers/manager.ts";
import { parseOr400, requireAdmin, requireUser } from "./guards.ts";

interface PrinterRoutesOptions {
  db: Database;
  manager: PrinterManager;
  secrets: SecretBox;
  factories: Map<string, PrinterDriverFactory>;
  /** Called after printers or groups change so clients can refetch. */
  onChange: () => void;
}

const idParams = z.object({ id: z.uuid() });
const orderSchema = z.object({ ids: z.array(z.uuid()).max(10_000) });
const TEST_TIMEOUT_MS = 8_000;

export function printerRoutes(app: FastifyInstance, options: PrinterRoutesOptions) {
  const { db, manager, secrets, factories, onChange } = options;
  // Licensing (F2) supplies a lease; until then the Free limits apply.
  const limits = () => effectiveLimits(null);
  const decryptKey = (value: string | null) => (value ? secrets.decrypt(value) : undefined);

  const listPrinters = async (): Promise<Printer[]> => {
    const rows = await db
      .select()
      .from(printers)
      .orderBy(asc(printers.position), asc(printers.createdAt));
    const limit = limits().printers;
    return rows.map((row, index) => ({
      id: row.id,
      name: row.name,
      driver: "moonraker" as const,
      url: row.url,
      hasApiKey: row.apiKeyEncrypted !== null,
      groupId: row.groupId,
      tags: row.tags,
      withinLimit: limit === null || index < limit,
      status: manager.getStatus(row.id),
    }));
  };

  const connect = (row: typeof printers.$inferSelect) =>
    manager.upsert(row.id, row.driver, { url: row.url, apiKey: decryptKey(row.apiKeyEncrypted) });

  app.get("/api/printers", { preHandler: requireUser }, async () => ({
    printers: await listPrinters(),
    limit: limits().printers,
  }));

  app.post("/api/printers/test", { preHandler: requireAdmin }, async (request, reply) => {
    const input = parseOr400(reply, connectionTestSchema.safeParse(request.body));
    if (!input) return;
    const driver = factories.get("moonraker")?.create();
    if (!driver) return reply.code(500).send({ error: "Driver unavailable." });
    const result: ConnectionTestResult = {
      ok: false,
      hostname: null,
      klippyState: null,
      error: null,
    };
    try {
      await Promise.race([
        driver.connect({ url: input.url, apiKey: input.apiKey ?? undefined }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timed out.")), TEST_TIMEOUT_MS),
        ),
      ]);
      const info = await driver.getInfo();
      Object.assign(result, { ok: true, hostname: info.hostname, klippyState: info.firmwareState });
    } catch (error) {
      result.error = error instanceof Error ? error.message : "Connection failed.";
    } finally {
      await driver.disconnect().catch(() => {});
    }
    return result;
  });

  app.post("/api/printers", { preHandler: requireAdmin }, async (request, reply) => {
    const input = parseOr400(reply, printerInputSchema.safeParse(request.body));
    if (!input) return;
    const limit = limits().printers;
    const [existing] = await db.select({ value: count() }).from(printers);
    if (limit !== null && (existing?.value ?? 0) >= limit) {
      return reply.code(403).send({
        error: `Your plan includes up to ${limit} printers. Remove a printer or upgrade to add more.`,
        code: "printer_limit",
      });
    }
    const [row] = await db
      .insert(printers)
      .values({
        name: input.name,
        url: input.url,
        apiKeyEncrypted: input.apiKey ? secrets.encrypt(input.apiKey) : null,
        groupId: input.groupId ?? null,
        tags: input.tags ?? [],
        position: existing?.value ?? 0,
      })
      .returning();
    if (!row) return reply.code(500).send({ error: "Could not save the printer." });
    connect(row);
    onChange();
    return reply.code(201).send((await listPrinters()).find((printer) => printer.id === row.id));
  });

  app.patch("/api/printers/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const input = params && parseOr400(reply, printerUpdateSchema.safeParse(request.body));
    if (!params || !input) return;
    const changes: Partial<typeof printers.$inferInsert> = {};
    if (input.name !== undefined) changes.name = input.name;
    if (input.url !== undefined) changes.url = input.url;
    if (input.apiKey !== undefined)
      changes.apiKeyEncrypted = input.apiKey ? secrets.encrypt(input.apiKey) : null;
    if (input.groupId !== undefined) changes.groupId = input.groupId;
    if (input.tags !== undefined) changes.tags = input.tags;
    const [row] = await db
      .update(printers)
      .set(changes)
      .where(eq(printers.id, params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: "Printer not found." });
    if (input.url !== undefined || input.apiKey !== undefined) connect(row);
    onChange();
    return (await listPrinters()).find((printer) => printer.id === row.id);
  });

  app.delete("/api/printers/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    const [row] = await db
      .delete(printers)
      .where(eq(printers.id, params.id))
      .returning({ id: printers.id });
    if (!row) return reply.code(404).send({ error: "Printer not found." });
    manager.remove(row.id);
    onChange();
    return { ok: true };
  });

  app.put("/api/printers/order", { preHandler: requireAdmin }, async (request, reply) => {
    const input = parseOr400(reply, orderSchema.safeParse(request.body));
    if (!input) return;
    await db.transaction(async (tx) => {
      for (const [position, id] of input.ids.entries()) {
        await tx.update(printers).set({ position }).where(eq(printers.id, id));
      }
    });
    onChange();
    return { ok: true };
  });

  app.post("/api/printers/:id/commands", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const command = params && parseOr400(reply, printerCommandSchema.safeParse(request.body));
    if (!params || !command) return;
    const printer = (await listPrinters()).find((p) => p.id === params.id);
    if (!printer) return reply.code(404).send({ error: "Printer not found." });
    // Safety commands always work; G-code can start prints, so it respects the plan limit.
    if (command.action === "gcode" && !printer.withinLimit) {
      return reply.code(403).send({
        error: "This printer is outside your plan's printer limit.",
        code: "printer_limit",
      });
    }
    try {
      await manager.command(params.id, command);
      return { ok: true };
    } catch (error) {
      const status = error instanceof PrinterNotConnectedError ? 409 : 502;
      return reply
        .code(status)
        .send({ error: error instanceof Error ? error.message : "Command failed." });
    }
  });

  app.get("/api/printer-groups", { preHandler: requireUser }, async () => ({
    groups: await db
      .select({ id: printerGroups.id, name: printerGroups.name })
      .from(printerGroups)
      .orderBy(asc(printerGroups.name)),
  }));

  app.post("/api/printer-groups", { preHandler: requireAdmin }, async (request, reply) => {
    const input = parseOr400(reply, printerGroupInputSchema.safeParse(request.body));
    if (!input) return;
    const [row] = await db
      .insert(printerGroups)
      .values({ name: input.name })
      .onConflictDoNothing()
      .returning({ id: printerGroups.id, name: printerGroups.name });
    if (!row) return reply.code(409).send({ error: "A group with this name already exists." });
    onChange();
    return reply.code(201).send(row);
  });

  app.patch("/api/printer-groups/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const input = params && parseOr400(reply, printerGroupInputSchema.safeParse(request.body));
    if (!params || !input) return;
    try {
      const [row] = await db
        .update(printerGroups)
        .set({ name: input.name })
        .where(eq(printerGroups.id, params.id))
        .returning({ id: printerGroups.id, name: printerGroups.name });
      if (!row) return reply.code(404).send({ error: "Group not found." });
      onChange();
      return row;
    } catch {
      return reply.code(409).send({ error: "A group with this name already exists." });
    }
  });

  app.delete("/api/printer-groups/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    const [row] = await db
      .delete(printerGroups)
      .where(eq(printerGroups.id, params.id))
      .returning({ id: printerGroups.id });
    if (!row) return reply.code(404).send({ error: "Group not found." });
    onChange();
    return { ok: true };
  });
}

/** Connects every stored printer; called once on startup. */
export async function connectStoredPrinters(
  db: Database,
  manager: PrinterManager,
  secrets: SecretBox,
) {
  for (const row of await db.select().from(printers)) {
    manager.upsert(row.id, row.driver, {
      url: row.url,
      apiKey: row.apiKeyEncrypted ? secrets.decrypt(row.apiKeyEncrypted) : undefined,
    });
  }
}
