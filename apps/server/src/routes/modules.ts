import { readFile } from "node:fs/promises";
import type { LoadedModule } from "@printrio/shared";
import type { FastifyInstance } from "fastify";
import type { ModuleHost } from "../licensing/modules.ts";
import { requireUser } from "./guards.ts";

/** Loaded modules, their web bundles, and the routes they register. */
export function moduleRoutes(app: FastifyInstance, host: ModuleHost) {
  app.get(
    "/api/modules",
    { preHandler: requireUser },
    async (): Promise<{
      modules: LoadedModule[];
    }> => ({ modules: host.list() }),
  );

  app.get<{ Params: { id: string } }>(
    "/api/modules/:id/web.js",
    { preHandler: requireUser },
    async (request, reply) => {
      const file = host.webFile(request.params.id);
      if (!file) return reply.code(404).send({ error: "Module not found." });
      return reply
        .type("text/javascript; charset=utf-8")
        .header("Cache-Control", "no-store")
        .send(await readFile(file));
    },
  );

  app.route<{ Params: { id: string; "*": string } }>({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    url: "/api/modules/:id/*",
    preHandler: requireUser,
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) return;
      const found = host.match(request.params.id, request.method, request.params["*"]);
      if (!found) return reply.code(404).send({ error: "Not found." });
      if (found.route.adminOnly && user.role !== "admin")
        return reply.code(403).send({ error: "Only administrators can do this." });
      // Core permissions the module route also needs (e.g. it creates orders or queues prints).
      if (user.role !== "admin" && request.method !== "GET")
        for (const permission of found.route.permissions ?? [])
          if (!(await host.authorize(user, permission)))
            return reply.code(403).send({ error: "Your role does not allow this.", permission });
      try {
        const result = await found.route.handler({
          userId: user.id,
          role: user.role,
          params: found.params,
          query: Object.fromEntries(
            Object.entries((request.query ?? {}) as Record<string, unknown>).map(([k, v]) => [
              k,
              String(v),
            ]),
          ),
          body: request.body ?? null,
        });
        return result ?? { ok: true };
      } catch (error) {
        const status = (error as { statusCode?: unknown }).statusCode;
        if (typeof status === "number" && status >= 400 && status < 500)
          return reply.code(status).send({ error: (error as Error).message });
        request.log.error(error);
        return reply.code(500).send({ error: "Module error." });
      }
    },
  });
}
