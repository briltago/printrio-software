import { type BackupsDto, backupSettingsSchema } from "@printrio/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { BackupError, type Backups } from "../backups/backups.ts";
import { parseOr400, requireAdmin } from "./guards.ts";

const fail = (reply: FastifyReply, error: unknown) => {
  if (error instanceof BackupError)
    return reply.code(error.statusCode).send({ error: error.message });
  throw error;
};

/** Settings → Backups (admins only). */
export function backupRoutes(app: FastifyInstance, backups: Backups) {
  app.get(
    "/api/backups",
    { preHandler: requireAdmin },
    async (): Promise<BackupsDto> => ({
      backups: await backups.list(),
      settings: await backups.settings(),
      available: await backups.toolsAvailable(),
      directory: backups.dir,
    }),
  );

  app.put("/api/backups/settings", { preHandler: requireAdmin }, async (request, reply) => {
    const input = parseOr400(reply, backupSettingsSchema.safeParse(request.body));
    if (!input) return;
    return backups.saveSettings(input);
  });

  app.post("/api/backups", { preHandler: requireAdmin }, async (request, reply) => {
    const includeFiles = (request.body as { includeFiles?: unknown } | null)?.includeFiles === true;
    try {
      return await backups.create("manual", { includeFiles });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get<{ Params: { name: string } }>(
    "/api/backups/:name/download",
    { preHandler: requireAdmin },
    async (request, reply) => {
      try {
        const file = backups.path(request.params.name);
        return reply
          .header("Content-Type", "application/gzip")
          .header("Content-Disposition", `attachment; filename="${request.params.name}"`)
          .send((await import("node:fs")).createReadStream(file));
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  app.delete<{ Params: { name: string } }>(
    "/api/backups/:name",
    { preHandler: requireAdmin },
    async (request, reply) => {
      try {
        await backups.remove(request.params.name);
        return { ok: true };
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  app.post("/api/backups/upload", { preHandler: requireAdmin }, async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "Choose a backup file." });
    try {
      return await backups.saveUpload(file.file);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post<{ Params: { name: string } }>(
    "/api/backups/:name/restore",
    { preHandler: requireAdmin },
    async (request, reply) => {
      try {
        await backups.restore(request.params.name);
        return { ok: true, restarting: true };
      } catch (error) {
        return fail(reply, error);
      }
    },
  );
}
