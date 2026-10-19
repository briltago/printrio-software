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
