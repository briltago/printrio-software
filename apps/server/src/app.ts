import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import type { ModuleChange, ModuleEvents, PrinterDriverFactory } from "@printrio/sdk";
import { LEASE_PUBLIC_KEY, LICENSING_URL, MODULE_PUBLIC_KEY } from "@printrio/shared";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import type { Config } from "./config.ts";
import type { SecretBox } from "./crypto.ts";
import type { Database } from "./db/client.ts";
import { printers } from "./db/schema.ts";
import { moonrakerDriverFactory } from "./drivers/moonraker.ts";
import { JobRecorder } from "./jobs/recorder.ts";
import { Library } from "./library/store.ts";
import { InstanceIdentity } from "./licensing/identity.ts";
import { Licence } from "./licensing/licence.ts";
import { ModuleHost } from "./licensing/modules.ts";
import type { PrinterManager } from "./printers/manager.ts";
import { apiKeyRoutes } from "./routes/api-keys.ts";
import { authRoutes } from "./routes/auth.ts";
import { filamentRoutes } from "./routes/filament.ts";
import { healthRoutes } from "./routes/health.ts";
import { jobRoutes } from "./routes/jobs.ts";
import { libraryRoutes } from "./routes/library.ts";
import { licenceRoutes } from "./routes/licence.ts";
import { moduleRoutes } from "./routes/modules.ts";
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
  /** Driver registry shared with the manager, so modules can add drivers. */
  factories?: Map<string, PrinterDriverFactory>;
  /**
   * Licensing endpoints and keys. Official builds use the pinned keys
   * (@printrio/shared licensing-keys.ts); tests pass their own.
   */
  licensing?: {
    url?: string;
    leasePublicKey?: string;
    modulePublicKey?: string;
    fetch?: typeof fetch;
    now?: () => Date;
  };
}

export const defaultDriverFactories = () =>
  new Map<string, PrinterDriverFactory>([[moonrakerDriverFactory.id, moonrakerDriverFactory]]);

export async function buildApp({
  config,
  db,
  secrets,
  manager,
  factories = defaultDriverFactories(),
  licensing = {},
}: AppOptions) {
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { level: config.LOG_LEVEL },
    trustProxy: true,
  });
  const printerManager = manager;
  const changes = new EventTarget();
  const notify = (type: "change" | "jobs" | "queue") => changes.dispatchEvent(new Event(type));

  // Licensing (docs/ARCHITECTURE.md §6–7): instance identity, lease, modules.
  const licensingUrl = licensing.url ?? config.LICENSING_URL ?? LICENSING_URL;
  const identity = await InstanceIdentity.load(db, secrets);
  const licence = new Licence({
    db,
    secrets,
    identity,
    url: licensingUrl,
    leasePublicKey: licensing.leasePublicKey ?? LEASE_PUBLIC_KEY,
    instanceName: async () => hostname(),
    fetch: licensing.fetch,
    now: licensing.now,
  });
  const limits = () => licence.limits();
  const withinLimit = (id: string) => printerWithinLimit(db, id, limits().printers);
  const moduleEvents = new EventEmitter();
  const emitModuleEvent = <E extends keyof ModuleEvents>(event: E, payload: ModuleEvents[E]) =>
    moduleEvents.emit(event, payload);
  const CHANGE_EVENT: Record<ModuleChange, "change" | "jobs" | "queue"> = {
    printers: "change",
    filament: "change",
    jobs: "jobs",
    queue: "queue",
  };
  const modules = new ModuleHost({
    db,
    dataDir: config.DATA_DIR,
    licence,
    url: licensingUrl,
    modulePublicKey: licensing.modulePublicKey ?? MODULE_PUBLIC_KEY,
    events: moduleEvents,
    factories,
    notifyChange: (change) => notify(CHANGE_EVENT[change]),
    logger: {
      info: (message) => app.log.info(message),
      warn: (message) => app.log.warn(message),
      error: (message) => app.log.error(message),
    },
    fetch: licensing.fetch,
  });
  licence.on("change", (lease) => {
    emitModuleEvent("licence.changed", { lease });
    // Limits and modules may have changed: browsers refetch once modules are in place.
    void modules.sync().then(() => notify("change"));
  });
  const onPrinterStatus = (printerId: string, status: ModuleEvents["printer.status"]["status"]) =>
    emitModuleEvent("printer.status", { printerId, status });
  printerManager.on("status", onPrinterStatus);

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(websocket);
  // G-code uploads (printer files and the library): one file per request, up to 1 GB.
  await app.register(multipart, { limits: { fileSize: 1024 * 1024 * 1024, files: 1 } });

  healthRoutes(app, db);
  authRoutes(app, { db, cookieSecure: config.COOKIE_SECURE });
  settingsRoutes(app, db);
  userRoutes(app, db, limits);
  printerRoutes(app, {
    db,
    manager: printerManager,
    secrets,
    factories,
    onChange: () => notify("change"),
    limits,
  });
  licenceRoutes(app, licence);
  moduleRoutes(app, modules);
  filamentRoutes(app, db, () => changes.dispatchEvent(new Event("change")));
  printerMediaRoutes(app, printerManager);
  printerConsoleRoutes(app, printerManager);
  printerConfigRoutes(app, db, printerManager);
  printerSystemRoutes(app, printerManager);
  printerUpdateRoutes(app, printerManager);
  printerMeshRoutes(app, printerManager, withinLimit);
  printerFileRoutes(app, printerManager, withinLimit);
  const recorder = new JobRecorder(
    db,
    printerManager,
    () => notify("jobs"),
    (event, job) => emitModuleEvent(event, { job }),
  );
  const library = new Library(config.DATA_DIR, db);
  libraryRoutes(app, db, library, printerManager, withinLimit);
  jobRoutes(app, db);
  queueRoutes(app, db, printerManager, recorder, library, withinLimit, () =>
    changes.dispatchEvent(new Event("queue")),
  );
  orderRoutes(app, db, () => changes.dispatchEvent(new Event("jobs")), {
    library,
    onEvent: (event, order) => {
      emitModuleEvent(event, { order });
      notify("jobs");
    },
  });
  realtimeRoutes(app, printerManager, changes);

  octoprintRoutes(
    app,
    db,
    library,
    printerManager,
    recorder,
    async (id) =>
      (await db.select({ id: printers.id }).from(printers).where(eq(printers.id, id))).length > 0,
    withinLimit,
    () => changes.dispatchEvent(new Event("queue")),
  );
  apiKeyRoutes(app, db);
  await recorder.start();
  await licence.start();
  void modules.sync();
  app.addHook("onClose", async () => {
    licence.stop();
    printerManager.off("status", onPrinterStatus);
    await modules.stop();
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
