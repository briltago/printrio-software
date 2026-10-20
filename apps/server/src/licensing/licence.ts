import { EventEmitter } from "node:events";
import {
  effectiveLimits,
  FREE_LIMITS,
  LEASE_REFRESH_HOURS,
  type Lease,
  type LicenceStatus,
  leaseSchema,
} from "@printrio/shared";
import { eq } from "drizzle-orm";
import type { SecretBox } from "../crypto.ts";
import type { Database } from "../db/client.ts";
import { instanceSettings } from "../db/schema.ts";
import { type InstanceIdentity, verifyJws } from "./identity.ts";

const KEY = "licence";
const REFRESH_MS = LEASE_REFRESH_HOURS * 60 * 60 * 1000;
/** After a failed refresh, try again this soon. */
const RETRY_MS = 15 * 60 * 1000;
const CHECK_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;

interface Summary {
  tier: Lease["tier"];
  email: string | null;
  managed: boolean;
  validUntil: string | null;
}

interface StoredLicence {
  /** Licence key, encrypted with the instance secret. */
  licenceKey: string;
  token: string | null;
  summary: Summary | null;
  lastRefreshAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
}

interface LicensingResponse {
  lease?: string;
  licence?: Summary;
  url?: string;
  error?: unknown;
  code?: unknown;
}

export class LicenceError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface LicenceOptions {
  db: Database;
  secrets: SecretBox;
  identity: InstanceIdentity;
  /** Base URL of printrio-licensing. */
  url: string;
  /** Pinned lease public key (raw Ed25519, base64url). Empty = licensing unavailable. */
  leasePublicKey: string;
  instanceName?: () => Promise<string>;
  fetch?: typeof fetch;
  now?: () => Date;
}

/**
 * The instance's licence (docs/ARCHITECTURE.md §7): activation, a lease
 * refreshed every few hours, and the limits that follow from it. Without a
 * valid lease everything falls back to Free. Emits "change" whenever the
 * effective lease changes (activation, refresh with new content, expiry).
 */
export class Licence extends EventEmitter<{ change: [Lease | null] }> {
  private stored: StoredLicence | null = null;
  private lease: Lease | null = null;
  private lastToken: string | null = null;
  private timer: NodeJS.Timeout | undefined;
  private refreshing: Promise<void> | null = null;

  constructor(private options: LicenceOptions) {
    super();
  }

  private get now() {
    return (this.options.now ?? (() => new Date()))();
  }

  get instanceId() {
    return this.options.identity.instanceId;
  }

  get available() {
    return this.options.leasePublicKey !== "";
  }

  async start() {
    const [row] = await this.options.db
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.key, KEY));
    this.stored = row ? (JSON.parse(row.value) as StoredLicence) : null;
    this.lease = this.verify(this.stored?.token ?? null);
    this.lastToken = this.current() ? (this.stored?.token ?? null) : null;
    this.timer = setInterval(() => void this.tick(), CHECK_MS);
    this.timer.unref();
    void this.tick();
  }

  stop() {
    clearInterval(this.timer);
  }

  /** The lease while it is valid, otherwise null (Free). */
  current(): Lease | null {
    if (!this.lease) return null;
    return new Date(this.lease.expiresAt).getTime() > this.now.getTime() ? this.lease : null;
  }

  limits() {
    return effectiveLimits(this.current(), this.now);
  }

  /** The current lease as the signed token (for module downloads). */
  token() {
    return this.current() ? (this.stored?.token ?? null) : null;
  }

  status(): LicenceStatus {
    const lease = this.current();
    const stored = this.stored;
    let masked: string | null = null;
    if (stored) {
      const key = this.decryptKey(stored);
      masked = key ? `•••••-${key.split("-").at(-1)}` : null;
    }
    return {
      instanceId: this.instanceId,
      available: this.available,
      activated: stored !== null,
      licenceKey: masked,
      tier: lease?.tier ?? "free",
      limits: lease?.limits ?? FREE_LIMITS,
      features: lease?.features ?? [],
      email: stored?.summary?.email ?? null,
      managed: stored?.summary?.managed ?? false,
      validUntil: stored?.summary?.validUntil ?? null,
      leaseExpiresAt: lease?.expiresAt ?? null,
      lastRefreshAt: stored?.lastRefreshAt ?? null,
      lastError: stored?.lastError ?? null,
    };
  }

  async activate(licenceKey: string) {
    if (!this.available)
      throw new LicenceError(
        503,
        "This build of Printrio has no licensing keys. Use an official release to activate a licence.",
      );
    const key = licenceKey.trim().toUpperCase();
    const timestamp = this.now.toISOString();
    const body = await this.request("/v1/activate", {
      licenceKey: key,
      instancePublicKey: this.options.identity.publicKey,
      instanceName: (await this.options.instanceName?.()) ?? "",
      timestamp,
      signature: this.options.identity.sign(`activate:${key}:${timestamp}`),
    });
    const lease = this.verify(body.lease ?? null);
    if (!lease) throw new LicenceError(502, "The licence server returned an invalid lease.");
    this.stored = {
      licenceKey: this.options.secrets.encrypt(key),
      token: body.lease ?? null,
      summary: body.licence ?? null,
      lastRefreshAt: timestamp,
      lastAttemptAt: timestamp,
      lastError: null,
    };
    this.lease = lease;
    await this.save();
    this.emitIfChanged();
    return this.status();
  }

  /** Refreshes the lease now (also used by the "Check now" button). */
  refresh() {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async deactivate() {
    if (!this.stored) return this.status();
    try {
      await this.request("/v1/deactivate", this.signed("deactivate"));
    } catch (error) {
      // Already unbound on the server: just forget it here too.
      if (!(error instanceof LicenceError && error.code === "not_activated")) throw error;
    }
    await this.clear();
    return this.status();
  }

  /** Link to the payment provider's customer portal. */
  async portalUrl() {
    if (!this.stored) throw new LicenceError(404, "No licence is activated.");
    const body = await this.request("/v1/portal", this.signed("portal"));
    return String(body.url);
  }

  private async doRefresh() {
    const stored = this.stored;
    if (!stored || !this.available) return;
    const attempt = this.now.toISOString();
    try {
      const body = await this.request("/v1/refresh", this.signed("refresh"));
      const lease = this.verify(body.lease ?? null);
      if (!lease) throw new LicenceError(502, "The licence server returned an invalid lease.");
      this.lease = lease;
      Object.assign(stored, {
        token: body.lease ?? null,
        summary: body.licence ?? stored.summary,
        lastRefreshAt: attempt,
        lastAttemptAt: attempt,
        lastError: null,
      });
    } catch (error) {
      if (error instanceof LicenceError && error.code === "not_activated") {
        // The licence was moved to another instance (portal/support): drop it.
        await this.clear();
        return;
      }
      // Keep the current lease: it stays valid until it expires (offline grace).
      stored.lastAttemptAt = attempt;
      stored.lastError = error instanceof Error ? error.message : String(error);
    }
    await this.save();
    this.emitIfChanged();
  }

  private async tick() {
    const stored = this.stored;
    if (stored) {
      const last = stored.lastAttemptAt ? new Date(stored.lastAttemptAt).getTime() : 0;
      const wait = stored.lastError ? RETRY_MS : REFRESH_MS;
      if (this.now.getTime() - last >= wait) await this.refresh().catch(() => {});
    }
    // A lease running out also changes what is unlocked.
    this.emitIfChanged();
  }

  private signed(action: string) {
    const timestamp = this.now.toISOString();
    return {
      instanceId: this.instanceId,
      timestamp,
      signature: this.options.identity.sign(`${action}:${this.instanceId}:${timestamp}`),
    };
  }

  private async request(path: string, payload: unknown): Promise<LicensingResponse> {
    const doFetch = this.options.fetch ?? fetch;
    let response: Response;
    try {
      response = await doFetch(new URL(path, this.options.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new LicenceError(
        502,
        "The licence server is unreachable. Check the internet connection.",
      );
    }
    const body = (await response.json().catch(() => ({}))) as LicensingResponse;
    if (!response.ok)
      throw new LicenceError(
        response.status >= 500 ? 502 : response.status === 401 ? 400 : response.status,
        typeof body.error === "string" ? body.error : `Licence server error (${response.status}).`,
        typeof body.code === "string" ? body.code : undefined,
      );
    return body;
  }

  /** The lease in `token` if it is signed by the pinned key and meant for this instance. */
  private verify(token: string | null): Lease | null {
    if (!token || !this.available) return null;
    const parsed = leaseSchema.safeParse(verifyJws(token, this.options.leasePublicKey));
    if (!parsed.success || parsed.data.instanceId !== this.instanceId) return null;
    return parsed.data;
  }

  private decryptKey(stored: StoredLicence) {
    try {
      return this.options.secrets.decrypt(stored.licenceKey);
    } catch {
      return null;
    }
  }

  private emitIfChanged() {
    const token = this.current() ? (this.stored?.token ?? null) : null;
    if (token === this.lastToken) return;
    const before = this.lastToken ? this.verify(this.lastToken) : null;
    this.lastToken = token;
    const after = this.current();
    // A refresh that only extends the expiry changes nothing that is unlocked.
    if (before && after && sameEntitlements(before, after)) return;
    this.emit("change", after);
  }

  private async clear() {
    this.stored = null;
    this.lease = null;
    await this.options.db.delete(instanceSettings).where(eq(instanceSettings.key, KEY));
    this.emitIfChanged();
  }

  private async save() {
    if (!this.stored) return;
    const value = JSON.stringify(this.stored);
    await this.options.db
      .insert(instanceSettings)
      .values({ key: KEY, value })
      .onConflictDoUpdate({ target: instanceSettings.key, set: { value, updatedAt: new Date() } });
  }
}

function sameEntitlements(a: Lease, b: Lease) {
  const pick = (lease: Lease) =>
    JSON.stringify([lease.licenceId, lease.tier, lease.limits, lease.features, lease.modules]);
  return pick(a) === pick(b);
}
