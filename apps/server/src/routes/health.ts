import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Database } from "../db/client.ts";
import { sourceUrl, VERSION } from "../version.ts";

export function healthRoutes(app: FastifyInstance, db: Database) {
  // Public: the version and its source code (AGPL section 13), also shown on the sign-in page.
  app.get("/api/about", async () => ({
    version: VERSION,
    sourceUrl: sourceUrl(),
    license: "AGPL-3.0-only",
  }));

  app.get("/api/health", async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });
}
