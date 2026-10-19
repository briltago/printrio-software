import type { Lease, Tier } from "@printrio/shared";
import type { PrinterDriverFactory } from "./driver.ts";

/**
 * Public module interface. Pro and Business are modules built against this
 * SDK and loaded by the core after licence activation (docs/ARCHITECTURE.md §6).
 */

export interface ModuleManifest {
  /** e.g. "pro", "business" */
  id: string;
  version: string;
  /** Minimum tier whose lease must list this module. */
  requiresTier: Exclude<Tier, "free">;
  /** Semver range of the core this module supports. */
  coreVersion: string;
}

export interface ModuleLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface ModuleRouteHandlerContext {
  userId: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
}

export interface ModuleRoute {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Mounted under /api/modules/<module id>/ */
  path: string;
  handler(ctx: ModuleRouteHandlerContext): Promise<unknown>;
}

export interface ModuleContext {
  logger: ModuleLogger;
  /** Current lease; modules must re-check it themselves before privileged work. */
  getLease(): Lease | null;
  registerRoutes(routes: ModuleRoute[]): void;
  registerDriver(factory: PrinterDriverFactory): void;
  /** Subscribe to core events (printer status, job finished, …). */
  on(event: string, listener: (payload: unknown) => void): () => void;
}

export interface PrintrioModule {
  manifest: ModuleManifest;
  /** SQL migrations owned by the module, applied in the module's own schema. */
  migrations?: { id: string; sql: string }[];
  activate(context: ModuleContext): Promise<void>;
  deactivate?(): Promise<void>;
}
