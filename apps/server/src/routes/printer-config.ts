import {
  type ConfigBackupDto,
  type ConfigFileContentDto,
  type ConfigFileDto,
  configPathSchema,
  configSaveSchema,
  type HostServiceDto,
  restartRequestSchema,
} from "@printrio/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.ts";
import { configBackups, users } from "../db/schema.ts";
import { type PrinterManager, PrinterNotConnectedError } from "../printers/manager.ts";
import { parseOr400, requireAdmin, requireUser } from "./guards.ts";

const idParams = z.object({ id: z.uuid() });
const backupParams = z.object({ id: z.uuid(), backupId: z.uuid() });
const pathQuery = z.object({ path: configPathSchema });
/** Backups kept per printer and file; older ones are pruned on save. */
const KEEP_BACKUPS = 30;
const BUSY_STATES = new Set(["printing", "paused"]);

/**
 * Printer administration: config files (with a backup of the previous version
 * in Printrio's database before every save) and restarts. Everything here is
 * admin-only, except restarting Klipper/the firmware, which operators need to
 * recover from an emergency stop.
 */
export function printerConfigRoutes(app: FastifyInstance, db: Database, manager: PrinterManager) {
  const failed = (reply: FastifyReply, error: unknown) => {
    if (error instanceof PrinterNotConnectedError)
      return reply.code(409).send({ error: error.message });
    return reply
      .code(502)
      .send({ error: error instanceof Error ? error.message : "The printer did not answer." });
  };
  const isBusy = (id: string) => BUSY_STATES.has(manager.getStatus(id).state);

  app.get(
    "/api/printers/:id/config/files",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = parseOr400(reply, idParams.safeParse(request.params));
      if (!params) return;
      try {
        const files = await manager.connected(params.id).listConfigFiles();
        return {
          files: files.map(
            (file): ConfigFileDto => ({ ...file, modified: file.modified.toISOString() }),
          ),
        };
      } catch (error) {
        return failed(reply, error);
      }
    },
  );

  app.get("/api/printers/:id/config/file", { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const query = params && parseOr400(reply, pathQuery.safeParse(request.query));
    if (!params || !query) return;
    try {
      const driver = manager.connected(params.id);
      const file = (await driver.listConfigFiles()).find((f) => f.path === query.path);
      if (!file) return reply.code(404).send({ error: "File not found." });
      const body: ConfigFileContentDto = {
        path: file.path,
        content: await driver.readConfigFile(file.path),
        modified: file.modified.toISOString(),
      };
      return body;
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.put("/api/printers/:id/config/file", { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const body = params && parseOr400(reply, configSaveSchema.safeParse(request.body));
    if (!params || !body) return;
    if (body.restart && isBusy(params.id))
      return reply.code(409).send({ error: "The printer is printing; save without restarting." });
    try {
      const driver = manager.connected(params.id);
      const current = (await driver.listConfigFiles()).find((f) => f.path === body.path);
      const changed = (current?.modified.toISOString() ?? null) !== body.baseModified;
      if (changed && !body.force) {
        return reply.code(409).send({
          error: "The file changed on the printer since you opened it.",
          code: "config_conflict",
        });
      }
      if (current) {
        await db.insert(configBackups).values({
          printerId: params.id,
          path: body.path,
          content: await driver.readConfigFile(body.path),
          createdBy: request.user?.id ?? null,
        });
        await pruneBackups(db, params.id, body.path);
      }
      await driver.writeConfigFile(body.path, body.content);
      if (body.restart) await driver.restartFirmware(false);
      const saved = (await driver.listConfigFiles()).find((f) => f.path === body.path);
      return { path: body.path, modified: saved?.modified.toISOString() ?? null };
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.get(
    "/api/printers/:id/config/backups",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = parseOr400(reply, idParams.safeParse(request.params));
      const query = params && parseOr400(reply, pathQuery.safeParse(request.query));
      if (!params || !query) return;
      const rows = await db
        .select({
          id: configBackups.id,
          path: configBackups.path,
          size: sql<number>`octet_length(${configBackups.content})`,
          createdAt: configBackups.createdAt,
          createdBy: users.displayName,
        })
        .from(configBackups)
        .leftJoin(users, eq(users.id, configBackups.createdBy))
        .where(and(eq(configBackups.printerId, params.id), eq(configBackups.path, query.path)))
        .orderBy(desc(configBackups.createdAt));
      return {
        backups: rows.map(
          (row): ConfigBackupDto => ({
            ...row,
            size: Number(row.size),
            createdAt: row.createdAt.toISOString(),
          }),
        ),
      };
    },
  );

  app.get(
    "/api/printers/:id/config/backups/:backupId",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = parseOr400(reply, backupParams.safeParse(request.params));
      if (!params) return;
      const [row] = await db
        .select({ path: configBackups.path, content: configBackups.content })
        .from(configBackups)
        .where(and(eq(configBackups.id, params.backupId), eq(configBackups.printerId, params.id)));
      if (!row) return reply.code(404).send({ error: "Backup not found." });
      return row;
    },
  );

  app.get("/api/printers/:id/services", { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    try {
      const services: HostServiceDto[] = await manager.connected(params.id).listServices();
      return { services };
    } catch (error) {
      return failed(reply, error);
    }
  });

  app.post("/api/printers/:id/restart", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const body = params && parseOr400(reply, restartRequestSchema.safeParse(request.body));
    if (!params || !body) return;
    const recovery = body.target === "klipper" || body.target === "firmware";
    if (!recovery && request.user?.role !== "admin")
      return reply.code(403).send({ error: "Only administrators can do this." });
    if (isBusy(params.id))
      return reply.code(409).send({ error: "The printer is printing. Cancel the print first." });
    try {
      const driver = manager.connected(params.id);
      if (body.target === "klipper" || body.target === "firmware")
        await driver.restartFirmware(body.target === "firmware");
      else if (body.target === "service") {
        const known = (await driver.listServices()).some((s) => s.name === body.service);
        if (!known) return reply.code(400).send({ error: "Unknown service." });
        await driver.restartService(body.service);
      } else await driver.hostPower(body.action);
      return { ok: true };
    } catch (error) {
      return failed(reply, error);
    }
  });
}

async function pruneBackups(db: Database, printerId: string, path: string) {
  const stale = await db
    .select({ id: configBackups.id })
    .from(configBackups)
    .where(and(eq(configBackups.printerId, printerId), eq(configBackups.path, path)))
    .orderBy(desc(configBackups.createdAt))
    .offset(KEEP_BACKUPS);
  if (stale.length)
    await db.delete(configBackups).where(
      inArray(
        configBackups.id,
        stale.map((row) => row.id),
      ),
    );
}
