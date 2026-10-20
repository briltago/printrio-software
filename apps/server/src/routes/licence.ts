import { activateLicenceSchema, type LicenceStatus } from "@printrio/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { type Licence, LicenceError } from "../licensing/licence.ts";
import { parseOr400, requireAdmin, requireUser } from "./guards.ts";

/** Settings → Licence: activation, status, refresh, deactivation, billing portal. */
export function licenceRoutes(app: FastifyInstance, licence: Licence) {
  const fail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof LicenceError)
      return reply.code(error.status).send({ error: error.message, code: error.code });
    throw error;
  };

  app.get(
    "/api/licence",
    { preHandler: requireUser },
    async (): Promise<LicenceStatus> => licence.status(),
  );

  app.post(
    "/api/licence/activate",
    {
      preHandler: requireAdmin,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const body = parseOr400(reply, activateLicenceSchema.safeParse(request.body));
      if (!body) return;
      try {
        return await licence.activate(body.licenceKey);
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  app.post("/api/licence/refresh", { preHandler: requireAdmin }, async () => {
    await licence.refresh();
    return licence.status();
  });

  app.post("/api/licence/deactivate", { preHandler: requireAdmin }, async (_request, reply) => {
    try {
      return await licence.deactivate();
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/api/licence/portal", { preHandler: requireAdmin }, async (_request, reply) => {
    try {
      return { url: await licence.portalUrl() };
    } catch (error) {
      return fail(reply, error);
    }
  });
}
