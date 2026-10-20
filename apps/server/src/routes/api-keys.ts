import { type ApiKeyCreatedDto, type ApiKeyDto, apiKeyCreateSchema } from "@printrio/shared";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createApiKey } from "../auth/api-keys.ts";
import type { Database } from "../db/client.ts";
import { apiKeys } from "../db/schema.ts";
import { parseOr400, requireUser } from "./guards.ts";

const toDto = (row: typeof apiKeys.$inferSelect): ApiKeyDto => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
});

/** Personal API keys of the signed-in user (for slicer uploads). */
export function apiKeyRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/api-keys", { preHandler: requireUser }, async (request) => {
    const rows = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.userId, request.user?.id ?? ""))
      .orderBy(desc(apiKeys.createdAt));
    return { keys: rows.map(toDto) };
  });

  app.post("/api/api-keys", { preHandler: requireUser }, async (request, reply) => {
    const body = parseOr400(reply, apiKeyCreateSchema.safeParse(request.body));
    if (!body || !request.user) return;
    const { row, key } = await createApiKey(db, request.user.id, body.name);
    const created: ApiKeyCreatedDto = { ...toDto(row), key };
    return reply.code(201).send(created);
  });

  app.delete("/api/api-keys/:id", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, z.object({ id: z.uuid() }).safeParse(request.params));
    if (!params) return;
    const deleted = await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, params.id), eq(apiKeys.userId, request.user?.id ?? "")))
      .returning();
    if (deleted.length === 0) return reply.code(404).send({ error: "API key not found." });
    return reply.code(204).send();
  });
}
