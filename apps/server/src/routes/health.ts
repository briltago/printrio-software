import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Database } from "../db/client.ts";

export function healthRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/health", async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });
}
