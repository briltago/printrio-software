import type { JobRecordDto, Lease, OrderDto, PrinterStatusDto, Tier } from "@printrio/shared";
import type { PrinterDriverFactory } from "./driver.ts";

/**
 * Public module interface. Pro and Business are modules built against this
 * SDK and loaded by the core after licence activation (docs/ARCHITECTURE.md §6).
 *
 * A module bundle has a server part (an ES module whose default export is a
 * `PrintrioModule`) and an optional web part (an ES module whose default
 * export is a `PrintrioWebModule`, see web.ts).
 */

/** Version of this interface; a module's `manifest.coreVersion` must match it. */
export const MODULE_API_VERSION = "1";

export interface ModuleManifest {
  /** e.g. "pro", "business" */
  id: string;
  version: string;
  /** Minimum tier whose lease must list this module. */
  requiresTier: Exclude<Tier, "free">;
  /** Module API version the module was built for (`MODULE_API_VERSION`). */
  coreVersion: string;
}

export interface ModuleLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface ModuleRouteHandlerContext {
  userId: string;
  role: "admin" | "operator";
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
}

export interface ModuleRoute {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Mounted under /api/modules/<module id>/; `:name` segments become params. */
  path: string;
  /** Only administrators may call it (default: any signed-in user). */
  adminOnly?: boolean;
  /** Returns the JSON response body. Throw a `ModuleHttpError`-like error ({ statusCode }) for 4xx. */
  handler(ctx: ModuleRouteHandlerContext): Promise<unknown>;
}

/**
 * SQL access. Statements run with `search_path` set to the module's own schema
 * (`module_<id>`) first and `public` second, so the module's tables need no
 * prefix and core tables (print_jobs, spools, …) stay readable.
 */
export interface ModuleDatabase {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** Events the core publishes to modules. */
export interface ModuleEvents {
  "printer.status": { printerId: string; status: PrinterStatusDto };
  "job.started": { job: JobRecordDto };
  "job.finished": { job: JobRecordDto };
  "licence.changed": { lease: Lease | null };
  "order.created": { order: OrderDto };
  "order.updated": { order: OrderDto };
  "order.deleted": { order: OrderDto };
}

/** Data the module changed, so open browsers refetch it. */
export type ModuleChange = "printers" | "jobs" | "queue" | "filament";

export interface ModuleContext {
  logger: ModuleLogger;
  /** Current lease; modules must re-check it themselves before privileged work. */
  getLease(): Lease | null;
  instanceId: string;
  db: ModuleDatabase;
  /** Private folder for the module's files (inside the data volume). */
  dataDir: string;
  registerRoutes(routes: ModuleRoute[]): void;
  registerDriver(factory: PrinterDriverFactory): void;
  /** Subscribe to core events; returns the unsubscribe function. */
  on<E extends keyof ModuleEvents>(
    event: E,
    listener: (payload: ModuleEvents[E]) => void,
  ): () => void;
  /** Tells connected browsers that data changed. */
  notifyChange(change: ModuleChange): void;
}

export interface PrintrioModule {
  manifest: ModuleManifest;
  /** SQL migrations owned by the module, applied once each in the module's own schema. */
  migrations?: { id: string; sql: string }[];
  activate(context: ModuleContext): Promise<void>;
  deactivate?(): Promise<void>;
}
