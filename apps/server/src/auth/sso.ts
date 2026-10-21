import { createHash, randomBytes } from "node:crypto";
import type { SsoSettingsDto, SsoSettingsInput } from "@printrio/shared";
import { eq } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { SecretBox } from "../crypto.ts";
import type { Database } from "../db/client.ts";
import { instanceSettings } from "../db/schema.ts";

/**
 * OpenID Connect sign-in (authorization code flow with PKCE, nonce and state).
 * The ID token is verified against the provider's published keys, issuer and
 * client ID; only verified e-mail addresses are accepted.
 */

const KEY = "sso";
const FLOW_TTL_MS = 10 * 60_000;

interface Stored {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecretEncrypted: string | null;
  label: string;
  allowedDomains: string[];
  autoCreate: boolean;
  publicUrl: string;
}

export interface SsoConfig extends Omit<Stored, "clientSecretEncrypted"> {
  clientSecret: string | null;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export class SsoError extends Error {}

export class Sso {
  private flows = new Map<
    string,
    { nonce: string; verifier: string; redirectUri: string; expires: number }
  >();
  private discovery: { issuer: string; data: Discovery; until: number } | null = null;
  private jwks: { uri: string; set: ReturnType<typeof createRemoteJWKSet> } | null = null;

  constructor(
    private readonly db: Database,
    private readonly secrets: SecretBox,
    private readonly available: () => boolean,
    private readonly doFetch: typeof fetch = (...args) => fetch(...args),
  ) {}

  async config(): Promise<SsoConfig | null> {
    const [row] = await this.db
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.key, KEY));
    if (!row) return null;
    const stored = JSON.parse(row.value) as Stored;
    return {
      ...stored,
      clientSecret: stored.clientSecretEncrypted
        ? this.secrets.decrypt(stored.clientSecretEncrypted)
        : null,
    };
  }

  /** Enabled and licensed. */
  async active() {
    const config = await this.config();
    return config?.enabled && this.available() ? config : null;
  }

  dto(config: SsoConfig | null, origin: string): SsoSettingsDto {
    return {
      available: this.available(),
      enabled: config?.enabled ?? false,
      issuer: config?.issuer ?? "",
      clientId: config?.clientId ?? "",
      hasSecret: Boolean(config?.clientSecret),
      label: config?.label ?? "SSO",
      allowedDomains: config?.allowedDomains ?? [],
      autoCreate: config?.autoCreate ?? false,
      publicUrl: config?.publicUrl ?? "",
      redirectUri: this.redirectUri(config, origin),
    };
  }

  redirectUri(config: Pick<SsoConfig, "publicUrl"> | null, origin: string) {
    return `${(config?.publicUrl || origin).replace(/\/+$/, "")}/api/auth/sso/callback`;
  }

  async save(input: SsoSettingsInput) {
    const current = await this.config();
    const clientSecret = input.clientSecret?.trim() || current?.clientSecret || null;
    if (input.enabled) {
      if (!this.available()) throw new SsoError("Single sign-on is part of Printrio Business.");
      await this.discover(input.issuer); // fails early on a wrong issuer
    }
    const stored: Stored = {
      enabled: input.enabled,
      issuer: input.issuer.replace(/\/+$/, ""),
      clientId: input.clientId,
      clientSecretEncrypted: clientSecret ? this.secrets.encrypt(clientSecret) : null,
      label: input.label,
      allowedDomains: input.allowedDomains,
      autoCreate: input.autoCreate,
      publicUrl: input.publicUrl ?? "",
    };
    const value = JSON.stringify(stored);
    await this.db
      .insert(instanceSettings)
      .values({ key: KEY, value })
      .onConflictDoUpdate({ target: instanceSettings.key, set: { value, updatedAt: new Date() } });
    this.discovery = null;
    return this.config();
  }

  private async discover(issuer: string): Promise<Discovery> {
    const base = issuer.replace(/\/+$/, "");
    if (this.discovery?.issuer === base && this.discovery.until > Date.now())
      return this.discovery.data;
    let response: Response;
    try {
      response = await this.doFetch(`${base}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new SsoError(`Could not reach ${new URL(base).host}.`);
    }
    if (!response.ok)
      throw new SsoError(
        `The identity provider answered ${response.status} for its OpenID configuration.`,
      );
    const data = (await response.json()) as Discovery;
    if (!data.authorization_endpoint || !data.token_endpoint || !data.jwks_uri)
      throw new SsoError("The issuer is not an OpenID Connect provider.");
    this.discovery = { issuer: base, data, until: Date.now() + 3_600_000 };
    return data;
  }

  /** Where to send the browser to sign in. */
  async start(origin: string) {
    const config = await this.active();
    if (!config) throw new SsoError("Single sign-on is not enabled.");
    const discovery = await this.discover(config.issuer);
    const now = Date.now();
    for (const [key, flow] of this.flows) if (flow.expires < now) this.flows.delete(key);
    const state = randomBytes(16).toString("base64url");
    const nonce = randomBytes(16).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const redirectUri = this.redirectUri(config, origin);
    this.flows.set(state, { nonce, verifier, redirectUri, expires: now + FLOW_TTL_MS });
    const url = new URL(discovery.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }

  /** Verifies the provider's answer; returns the signed-in identity. */
  async finish(code: string, state: string) {
    const config = await this.active();
    if (!config) throw new SsoError("Single sign-on is not enabled.");
    const flow = this.flows.get(state);
    this.flows.delete(state);
    if (!flow || flow.expires < Date.now())
      throw new SsoError("The sign-in took too long or was started elsewhere. Try again.");
    const discovery = await this.discover(config.issuer);
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: flow.redirectUri,
      client_id: config.clientId,
      code_verifier: flow.verifier,
      ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
    });
    const response = await this.doFetch(discovery.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!response?.ok) throw new SsoError("The identity provider did not accept the sign-in.");
    const tokens = (await response.json()) as { id_token?: string };
    if (!tokens.id_token) throw new SsoError("The identity provider sent no ID token.");
    if (this.jwks?.uri !== discovery.jwks_uri)
      this.jwks = { uri: discovery.jwks_uri, set: createRemoteJWKSet(new URL(discovery.jwks_uri)) };
    let claims: Record<string, unknown>;
    try {
      ({ payload: claims } = await jwtVerify(tokens.id_token, this.jwks.set, {
        issuer: discovery.issuer,
        audience: config.clientId,
        clockTolerance: 60,
      }));
    } catch {
      throw new SsoError("The sign-in could not be verified.");
    }
    if (claims.nonce !== flow.nonce) throw new SsoError("The sign-in could not be verified.");
    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
    // Providers that omit email_verified (e.g. Entra ID work accounts) vouch for their tenant's addresses.
    if (!email || claims.email_verified === false)
      throw new SsoError("Your account has no verified e-mail address.");
    const domain = email.split("@")[1] ?? "";
    if (config.allowedDomains.length && !config.allowedDomains.includes(domain))
      throw new SsoError(`Accounts from ${domain} cannot sign in here.`);
    const name =
      typeof claims.name === "string" && claims.name.trim()
        ? claims.name.trim().slice(0, 80)
        : (email.split("@")[0] ?? email);
    return { email, name, autoCreate: config.autoCreate };
  }
}
