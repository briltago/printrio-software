import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import type { PrinterDriverFactory } from "@printrio/sdk";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import type { Config } from "./config.ts";
import type { SecretBox } from "./crypto.ts";
import type { Database } from "./db/client.ts";
import { printers } from "./db/schema.ts";
import { moonrakerDriverFactory } from "./drivers/moonraker.ts";
import { JobRecorder } from "./jobs/recorder.ts";
import { Library } from "./library/store.ts";
import type { PrinterManager } from "./printers/manager.ts";
import { apiKeyRoutes } from "./routes/api-keys.ts";
import { authRoutes } from "./routes/auth.ts";
import { filamentRoutes } from "./routes/filament.ts";
import { healthRoutes } from "./routes/health.ts";
import { jobRoutes } from "./routes/jobs.ts";
import { libraryRoutes } from "./routes/library.ts";
import { octoprintRoutes } from "./routes/octoprint.ts";
import { orderRoutes } from "./routes/orders.ts";
import { printerConfigRoutes } from "./routes/printer-config.ts";
import { printerConsoleRoutes } from "./routes/printer-console.ts";
import { printerFileRoutes } from "./routes/printer-files.ts";
import { printerMediaRoutes } from "./routes/printer-media.ts";
import { printerMeshRoutes } from "./routes/printer-mesh.ts";
import { printerSystemRoutes } from "./routes/printer-system.ts";
import { printerUpdateRoutes } from "./routes/printer-updates.ts";
import { printerRoutes, printerWithinLimit } from "./routes/printers.ts";
import { queueRoutes } from "./routes/queue.ts";
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
  // G-code uploads (printer files and the library): one file per request, up to 1 GB.
  await app.register(multipart, { limits: { fileSize: 1024 * 1024 * 1024, files: 1 } });

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
  filamentRoutes(app, db, () => changes.dispatchEvent(new Event("change")));
  printerMediaRoutes(app, printerManager);
  printerConsoleRoutes(app, printerManager);
  printerConfigRoutes(app, db, printerManager);
  printerSystemRoutes(app, printerManager);
  printerUpdateRoutes(app, printerManager);
  printerMeshRoutes(app, printerManager, (id) => printerWithinLimit(db, id));
  printerFileRoutes(app, printerManager, (id) => printerWithinLimit(db, id));
  const recorder = new JobRecorder(db, printerManager, () =>
    changes.dispatchEvent(new Event("jobs")),
  );
  const library = new Library(config.DATA_DIR, db);
  libraryRoutes(app, db, library, printerManager, (id) => printerWithinLimit(db, id));
  jobRoutes(app, db);
  queueRoutes(
    app,
    db,
    printerManager,
    recorder,
    library,
    (id) => printerWithinLimit(db, id),
    () => changes.dispatchEvent(new Event("queue")),
  );
  orderRoutes(app, db, () => changes.dispatchEvent(new Event("jobs")));
  realtimeRoutes(app, printerManager, changes);

  octoprintRoutes(
    app,
    db,
    library,
    printerManager,
    recorder,
    async (id) =>
      (await db.select({ id: printers.id }).from(printers).where(eq(printers.id, id))).length > 0,
    (id) => printerWithinLimit(db, id),
    () => changes.dispatchEvent(new Event("queue")),
  );
  apiKeyRoutes(app, db);
  await recorder.start();
  app.addHook("onClose", async () => {
    recorder.stop();
    await recorder.idle();
    printerManager.stop();
  });

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
