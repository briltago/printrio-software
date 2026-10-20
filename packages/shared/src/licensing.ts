import { z } from "zod";

export const tierSchema = z.enum(["free", "pro", "business"]);
export type Tier = z.infer<typeof tierSchema>;

export const limitsSchema = z.object({
  /** Maximum number of printers that may run jobs. `null` = unlimited. */
  printers: z.number().int().positive().nullable(),
  /** Maximum number of user accounts. `null` = unlimited. */
  users: z.number().int().positive().nullable(),
});
export type Limits = z.infer<typeof limitsSchema>;

/** Limits applied when no valid lease is present. Enforced in the open-source core. */
export const FREE_LIMITS: Limits = { printers: 3, users: 2 };

/** Offline grace period: a lease is valid this long after the last successful refresh. */
export const LEASE_TTL_HOURS = 72;
/** How often the core refreshes its lease with printrio-licensing. */
export const LEASE_REFRESH_HOURS = 6;

/** Payload of the signed lease issued by printrio-licensing (see docs/ARCHITECTURE.md §7). */
export const leaseSchema = z.object({
  licenceId: z.string().min(1),
  instanceId: z.string().min(1),
  tier: tierSchema,
  limits: limitsSchema,
  features: z.array(z.string()),
  modules: z.array(z.object({ id: z.string(), version: z.string() })),
  issuedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type Lease = z.infer<typeof leaseSchema>;

/** Returns the limits in force: the lease's limits while it is valid, otherwise Free. */
export function effectiveLimits(lease: Lease | null, now: Date = new Date()): Limits {
  if (!lease || new Date(lease.expiresAt).getTime() <= now.getTime()) return FREE_LIMITS;
  return lease.limits;
}

/** Licence state shown in Settings → Licence. */
export const licenceStatusSchema = z.object({
  instanceId: z.string(),
  /** Whether this build has the pinned public keys (official builds do). */
  available: z.boolean(),
  activated: z.boolean(),
  /** Masked licence key (last block only). */
  licenceKey: z.string().nullable(),
  tier: tierSchema,
  limits: limitsSchema,
  features: z.array(z.string()),
  email: z.string().nullable(),
  /** Subscription managed by Paddle (portal available). */
  managed: z.boolean(),
  /** End of a fixed-term licence; null while a subscription renews. */
  validUntil: z.string().nullable(),
  leaseExpiresAt: z.string().nullable(),
  lastRefreshAt: z.string().nullable(),
  /** Last refresh/activation problem, e.g. the licence server being unreachable. */
  lastError: z.string().nullable(),
});
export type LicenceStatus = z.infer<typeof licenceStatusSchema>;

export const activateLicenceSchema = z.object({
  licenceKey: z.string().trim().min(10).max(64),
});

/** Module currently loaded by the core. */
export const loadedModuleSchema = z.object({
  id: z.string(),
  version: z.string(),
  /** Has a web part served at /api/modules/<id>/web.js. */
  web: z.boolean(),
  status: z.enum(["active", "error"]),
  error: z.string().nullable(),
});
export type LoadedModule = z.infer<typeof loadedModuleSchema>;

/**
 * Signed module bundle as served by printrio-licensing. `server` and `web`
 * are ES modules (base64); `signature` is Ed25519 over `moduleSigningMessage`.
 */
export const moduleBundleSchema = z.object({
  format: z.literal(1),
  manifest: z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    version: z.string().min(1),
    requiresTier: z.enum(["pro", "business"]),
    coreVersion: z.string().min(1),
  }),
  server: z.string().nullable(),
  web: z.string().nullable(),
  serverSha256: z.string().nullable(),
  webSha256: z.string().nullable(),
  signature: z.string().min(40),
});
export type ModuleBundle = z.infer<typeof moduleBundleSchema>;

/** The exact text a module signature covers (hashes are of the decoded code). */
export function moduleSigningMessage(bundle: Omit<ModuleBundle, "signature" | "server" | "web">) {
  const { id, version, requiresTier, coreVersion } = bundle.manifest;
  return [
    "printrio-module:v1",
    id,
    version,
    requiresTier,
    coreVersion,
    bundle.serverSha256 ?? "-",
    bundle.webSha256 ?? "-",
  ].join("\n");
}
