import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MODULE_API_VERSION,
  type ModuleChange,
  type ModuleContext,
  type ModuleEvents,
  type ModuleRoute,
  type PrinterDriverFactory,
  type PrintrioModule,
} from "@printrio/sdk";
import {
  type Lease,
  type LoadedModule,
  type ModuleBundle,
  moduleBundleSchema,
  moduleSigningMessage,
  type Permission,
} from "@printrio/shared";
import type { Database } from "../db/client.ts";
import type { OrderService } from "../orders/service.ts";
import { verifyEd25519 } from "./identity.ts";
import type { Licence } from "./licence.ts";

const DOWNLOAD_TIMEOUT_MS = 60_000;
const TIER_RANK = { free: 0, pro: 1, business: 2 } as const;

export class ModuleError extends Error {}

/** Where the core publishes `ModuleEvents` (an EventEmitter). */
export interface ModuleEventBus {
  on(event: keyof ModuleEvents, listener: (payload: unknown) => void): unknown;
  off(event: keyof ModuleEvents, listener: (payload: unknown) => void): unknown;
}

export interface ModuleHostOptions {
  db: Database;
  dataDir: string;
  licence: Licence;
  /** Base URL of printrio-licensing. */
  url: string;
  /** Pinned module public key (raw Ed25519, base64url). Empty = no modules. */
  modulePublicKey: string;
  events: ModuleEventBus;
  factories: Map<string, PrinterDriverFactory>;
  notifyChange: (change: ModuleChange) => void;
  /** Orders for modules (Business turns accepted quotes into orders). */
  orders?: OrderService;
  logger: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
  fetch?: typeof fetch;
}

interface Route extends ModuleRoute {
  pattern: RegExp;
  names: string[];
}

type Authorizer = Parameters<NonNullable<ModuleContext["registerAuthorizer"]>>[0];

interface Loaded {
  id: string;
  version: string;
  module: PrintrioModule | null;
  routes: Route[];
  webFile: string | null;
  error: string | null;
  cleanup: (() => void)[];
}

/**
 * Downloads, verifies and runs the modules listed in the lease
 * (docs/ARCHITECTURE.md §6). Bundles are cached in DATA_DIR/modules and
 * verified against the pinned module key every time they are loaded; a
 * missing or tampered signature means the module does not run.
 */
export class ModuleHost {
  private readonly authorizers = new Set<Authorizer>();

  /**
   * Asks the modules' authorizers (custom roles) whether a user may do
   * something. Fails closed: an error refuses the request.
   */
  async authorize(user: { id: string; role: "admin" | "operator" }, permission: Permission) {
    for (const authorize of this.authorizers) {
      try {
        if ((await authorize(user, permission)) === false) return false;
      } catch (error) {
        this.options.logger.error(`Authorizer failed: ${error}`);
        return false;
      }
    }
    return true;
  }

  private loaded = new Map<string, Loaded>();
  private syncing: Promise<void> = Promise.resolve();
  private root: string;

  constructor(private options: ModuleHostOptions) {
    this.root = resolve(options.dataDir, "modules");
  }

  /** Loads what the lease lists and unloads the rest; serialised. */
  sync() {
    this.syncing = this.syncing
      .then(() => this.doSync())
      .catch((error) => {
        this.options.logger.error(`Module sync failed: ${error}`);
      });
    return this.syncing;
  }

  list(): LoadedModule[] {
    return [...this.loaded.values()].map((entry) => ({
      id: entry.id,
      version: entry.version,
      web: entry.webFile !== null && entry.error === null,
      status: entry.error ? "error" : "active",
      error: entry.error,
    }));
  }

  /** Path of an active module's verified web bundle. */
  webFile(id: string) {
    const entry = this.loaded.get(id);
    return entry && !entry.error ? entry.webFile : null;
  }

  /** Finds the module route for a request below /api/modules/<id>/. */
  match(id: string, method: string, path: string) {
    const entry = this.loaded.get(id);
    if (!entry || entry.error) return null;
    for (const route of entry.routes) {
      if (route.method !== method) continue;
      const found = route.pattern.exec(path);
      if (!found) continue;
      const params: Record<string, string> = {};
      route.names.forEach((name, index) => {
        params[name] = decodeURIComponent(found[index + 1] ?? "");
      });
      return { route, params };
    }
    return null;
  }

  async stop() {
    await this.syncing;
    for (const entry of this.loaded.values()) await this.unload(entry);
    this.loaded.clear();
  }

  private async doSync() {
    const lease = this.options.licence.current();
    const wanted = new Map(
      (this.options.modulePublicKey ? (lease?.modules ?? []) : []).map((m) => [m.id, m.version]),
    );
    for (const entry of [...this.loaded.values()]) {
      if (wanted.get(entry.id) !== entry.version) {
        await this.unload(entry);
        this.loaded.delete(entry.id);
      }
    }
    for (const [id, version] of wanted) {
      if (this.loaded.has(id) || !lease) continue;
      this.loaded.set(id, await this.load(id, version, lease));
    }
  }

  private async load(id: string, version: string, lease: Lease): Promise<Loaded> {
    const entry: Loaded = {
      id,
      version,
      module: null,
      routes: [],
      webFile: null,
      error: null,
      cleanup: [],
    };
    try {
      const bundle = await this.bundle(id, version);
      const tierOk = TIER_RANK[lease.tier] >= TIER_RANK[bundle.manifest.requiresTier];
      if (!tierOk) throw new ModuleError(`Requires the ${bundle.manifest.requiresTier} plan.`);
      if (bundle.manifest.coreVersion !== MODULE_API_VERSION)
        throw new ModuleError("Built for a different Printrio version; update Printrio.");

      const directory = join(this.root, id, version);
      await mkdir(directory, { recursive: true });
      if (bundle.web) {
        entry.webFile = join(directory, "web.js");
        await writeFile(entry.webFile, Buffer.from(bundle.web, "base64"));
      }
      if (bundle.server) {
        const serverFile = join(directory, "server.mjs");
        await writeFile(serverFile, Buffer.from(bundle.server, "base64"));
        const imported = (await import(pathToFileURL(serverFile).href)) as {
          default?: PrintrioModule;
        };
        const module = imported.default;
        if (!module || module.manifest?.id !== id || typeof module.activate !== "function")
          throw new ModuleError("The bundle does not export a Printrio module.");
        await this.migrate(id, module);
        await module.activate(this.context(entry));
        entry.module = module;
      }
      this.options.logger.info(`Module ${id} ${version} loaded.`);
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      this.options.logger.error(`Module ${id} ${version} failed: ${entry.error}`);
      for (const cleanup of entry.cleanup) cleanup();
      entry.cleanup = [];
      entry.routes = [];
    }
    return entry;
  }

  private async unload(entry: Loaded) {
    try {
      await entry.module?.deactivate?.();
    } catch (error) {
      this.options.logger.warn(`Module ${entry.id} deactivate failed: ${error}`);
    }
    for (const cleanup of entry.cleanup) cleanup();
    entry.cleanup = [];
    entry.routes = [];
    this.options.logger.info(`Module ${entry.id} ${entry.version} unloaded.`);
  }

  /** The verified bundle, from the cache or downloaded with the current lease. */
  private async bundle(id: string, version: string): Promise<ModuleBundle> {
    const file = join(this.root, id, `${version}.json`);
    const cached = await readFile(file, "utf8").catch(() => null);
    if (cached) {
      const bundle = this.verify(cached, id, version);
      if (bundle) return bundle;
    }
    const token = this.options.licence.token();
    if (!token) throw new ModuleError("No valid lease.");
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(
        new URL(`/v1/modules/${id}/${encodeURIComponent(version)}`, this.options.url),
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        },
      );
    } catch {
      throw new ModuleError("The licence server is unreachable.");
    }
    if (!response.ok) throw new ModuleError(`Download failed (${response.status}).`);
    const text = await response.text();
    const bundle = this.verify(text, id, version);
    if (!bundle) throw new ModuleError("The module signature is invalid.");
    await mkdir(join(this.root, id), { recursive: true });
    await writeFile(`${file}.tmp`, text);
    await rename(`${file}.tmp`, file);
    return bundle;
  }

  private verify(text: string, id: string, version: string): ModuleBundle | null {
    let parsed: ReturnType<typeof moduleBundleSchema.safeParse>;
    try {
      parsed = moduleBundleSchema.safeParse(JSON.parse(text));
    } catch {
      return null;
    }
    if (!parsed.success) return null;
    const bundle = parsed.data;
    if (bundle.manifest.id !== id || bundle.manifest.version !== version) return null;
    const hash = (code: string | null) =>
      code === null ? null : createHash("sha256").update(Buffer.from(code, "base64")).digest("hex");
    if (hash(bundle.server) !== bundle.serverSha256 || hash(bundle.web) !== bundle.webSha256)
      return null;
    const message = moduleSigningMessage(bundle);
    return verifyEd25519(this.options.modulePublicKey, message, bundle.signature) ? bundle : null;
  }

  private schemaOf(id: string) {
    return `module_${id.replace(/-/g, "_")}`;
  }

  private async migrate(id: string, module: PrintrioModule) {
    const schema = this.schemaOf(id);
    const client = this.options.db.$client;
    await client.unsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await client.unsafe(
      `CREATE TABLE IF NOT EXISTS "${schema}"."__migrations" (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    for (const migration of module.migrations ?? []) {
      await client.begin(async (tx) => {
        const done = await tx.unsafe(`SELECT 1 FROM "${schema}"."__migrations" WHERE id = $1`, [
          migration.id,
        ]);
        if (done.length > 0) return;
        await tx.unsafe(`SET LOCAL search_path TO "${schema}", public`);
        await tx.unsafe(migration.sql);
        await tx.unsafe(`INSERT INTO "${schema}"."__migrations" (id) VALUES ($1)`, [migration.id]);
      });
    }
  }

  private context(entry: Loaded): ModuleContext {
    const { id } = entry;
    const schema = this.schemaOf(id);
    const prefix = `[module ${id}]`;
    const log = this.options.logger;
    const fmt = (message: string, data?: Record<string, unknown>) =>
      data ? `${prefix} ${message} ${JSON.stringify(data)}` : `${prefix} ${message}`;
    return {
      logger: {
        info: (message, data) => log.info(fmt(message, data)),
        warn: (message, data) => log.warn(fmt(message, data)),
        error: (message, data) => log.error(fmt(message, data)),
      },
      getLease: () => this.options.licence.current(),
      instanceId: this.options.licence.instanceId,
      dataDir: join(this.root, id, "data"),
      db: {
        query: async <T>(sql: string, params: unknown[] = []) =>
          (await this.options.db.$client.begin(async (tx) => {
            await tx.unsafe(`SET LOCAL search_path TO "${schema}", public`);
            return tx.unsafe(sql, params as never[]);
          })) as unknown as T[],
      },
      registerRoutes: (routes) => {
        for (const route of routes) entry.routes.push(compileRoute(route));
      },
      registerDriver: (factory) => {
        this.options.factories.set(factory.id, factory);
        entry.cleanup.push(() => this.options.factories.delete(factory.id));
      },
      on: (event, listener) => {
        // A failing module listener must not break the core.
        const safe = (payload: unknown) => {
          try {
            const result: unknown = listener(payload as never);
            if (result instanceof Promise)
              result.catch((error) => log.error(`${prefix} ${event} listener: ${error}`));
          } catch (error) {
            log.error(`${prefix} ${event} listener: ${error}`);
          }
        };
        this.options.events.on(event, safe);
        const off = () => this.options.events.off(event, safe);
        entry.cleanup.push(off);
        return off;
      },
      notifyChange: (change) => this.options.notifyChange(change),
      registerAuthorizer: (authorize) => {
        this.authorizers.add(authorize);
        entry.cleanup.push(() => this.authorizers.delete(authorize));
      },
      orders: this.options.orders && {
        get: (orderId) => (this.options.orders as OrderService).get(orderId),
        create: (input) => (this.options.orders as OrderService).create(input),
        update: (orderId, changes) =>
          (this.options.orders as OrderService).update(orderId, changes),
      },
    };
  }
}

function compileRoute(route: ModuleRoute): Route {
  const names: string[] = [];
  const path = route.path.replace(/^\/+|\/+$/g, "");
  const source = path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        names.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { ...route, pattern: new RegExp(`^${source}$`), names };
}
