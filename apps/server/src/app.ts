import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import type { PrinterDriverFactory } from "@printrio/sdk";
import Fastify from "fastify";
import type { Config } from "./config.ts";
import type { SecretBox } from "./crypto.ts";
import type { Database } from "./db/client.ts";
import { moonrakerDriverFactory } from "./drivers/moonraker.ts";
import type { PrinterManager } from "./printers/manager.ts";
import { authRoutes } from "./routes/auth.ts";
import { healthRoutes } from "./routes/health.ts";
import { printerRoutes } from "./routes/printers.ts";
import { realtimeRoutes } from "./routes/realtime.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { userRoutes } from "./routes/users.ts";

export interface AppOptions {
  config: Config;
  db: Database;
  secrets: SecretBox;
  manager: PrinterManager;
}

export const defaultDriverFactories = () =>
  new Map<string, PrinterDriverFactory>([[moonrakerDriverFactory.id, moonrakerDriverFactory]]);

export async function buildApp({ config, db, secrets, manager }: AppOptions) {
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { level: config.LOG_LEVEL },
    trustProxy: true,
  });
  const factories = defaultDriverFactories();
  const printerManager = manager;
  const changes = new EventTarget();

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(websocket);

  healthRoutes(app, db);
  authRoutes(app, { db, cookieSecure: config.COOKIE_SECURE });
  settingsRoutes(app, db);
  userRoutes(app, db);
  printerRoutes(app, {
    db,
    manager: printerManager,
    secrets,
    factories,
    onChange: () => changes.dispatchEvent(new Event("change")),
  });
  realtimeRoutes(app, printerManager, changes);

  app.addHook("onClose", () => printerManager.stop());

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
