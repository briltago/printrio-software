import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { Config } from "./config.ts";
import type { Database } from "./db/client.ts";
import { authRoutes } from "./routes/auth.ts";
import { healthRoutes } from "./routes/health.ts";

export interface AppOptions {
  config: Config;
  db: Database;
}

export async function buildApp({ config, db }: AppOptions) {
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { level: config.LOG_LEVEL },
    trustProxy: true,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  healthRoutes(app, db);
  authRoutes(app, { db, cookieSecure: config.COOKIE_SECURE });

  if (config.WEB_DIR && existsSync(config.WEB_DIR)) {
    await app.register(fastifyStatic, { root: resolve(config.WEB_DIR), wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not found." });
    });
  }

  return app;
}
