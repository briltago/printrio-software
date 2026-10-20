import { createHash, generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { type Lease, type LoadedModule, moduleSigningMessage } from "@printrio/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instanceIdOf, verifyEd25519 } from "../src/licensing/identity.ts";
import { createTestApp, sessionCookie } from "./helpers.ts";

const LICENCE_KEY = "PRIO-AAAAA-BBBBB-CCCCC-DDDDD";

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, raw: publicKey.export({ format: "jwk" }).x as string };
}

const leaseKeys = keypair();
const moduleKeys = keypair();

function jws(payload: unknown, key: KeyObject) {
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "printrio-lease" })).toString(
    "base64url",
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(null, Buffer.from(`${header}.${body}`), key).toString("base64url");
  return `${header}.${body}.${signature}`;
}

/** A module bundle like printrio-pro's build produces. */
function bundle(server: string, options: { version?: string; key?: KeyObject } = {}) {
  const sha = (code: string) => createHash("sha256").update(code).digest("hex");
  const web = "export default { id: 'test', setup() { return {}; } };";
  const unsigned = {
    format: 1 as const,
    manifest: {
      id: "test",
      version: options.version ?? "1.0.0",
      requiresTier: "pro" as const,
      coreVersion: "1",
    },
    server: Buffer.from(server).toString("base64"),
    web: Buffer.from(web).toString("base64"),
    serverSha256: sha(server),
    webSha256: sha(web),
  };
  const signature = sign(
    null,
    Buffer.from(moduleSigningMessage(unsigned)),
    options.key ?? moduleKeys.privateKey,
  ).toString("base64url");
  return JSON.stringify({ ...unsigned, signature });
}

const MODULE_SERVER = `
export default {
  manifest: { id: "test", version: "1.0.0", requiresTier: "pro", coreVersion: "1" },
  migrations: [{ id: "0001", sql: "CREATE TABLE notes (id serial PRIMARY KEY, text text NOT NULL)" }],
  async activate(ctx) {
    ctx.registerRoutes([
      { method: "GET", path: "notes", handler: async () => ({ notes: await ctx.db.query("SELECT text FROM notes ORDER BY id") }) },
      { method: "POST", path: "notes", adminOnly: true, handler: async ({ body }) => {
        await ctx.db.query("INSERT INTO notes (text) VALUES ($1)", [body.text]);
        return { ok: true };
      } },
      { method: "GET", path: "hello/:name", handler: async ({ params }) => ({ hello: params.name, tier: ctx.getLease()?.tier }) },
      { method: "POST", path: "orders", handler: async ({ body }) => {
        const order = await ctx.orders.create({ name: body.name, customer: "Acme" });
        const done = await ctx.orders.update(order.id, { status: "in_progress" });
        return { created: order, updated: done, missing: await ctx.orders.get("00000000-0000-0000-0000-000000000000") };
      } },
    ]);
    ctx.on("order.created", ({ order }) => { globalThis.__moduleOrderEvents = [...(globalThis.__moduleOrderEvents ?? []), order.name]; });
  },
};
`;

/** In-memory printrio-licensing: one licence, one module. */
class FakeLicensing {
  boundKey: string | null = null;
  tier: Lease["tier"] = "pro";
  printers: number | null = 8;
  modules = [{ id: "test", version: "1.0.0" }];
  bundles = new Map([["test/1.0.0", bundle(MODULE_SERVER)]]);
  refreshes = 0;
  offline = false;
  now = () => new Date();

  fetch = async (input: string | URL | Request, init?: RequestInit) => {
    if (this.offline) throw new TypeError("fetch failed");
    const url = new URL(String(input));
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname === "/v1/activate") {
      if (body.licenceKey !== LICENCE_KEY)
        return json({ error: "Unknown licence key.", code: "licence_unknown" }, 404);
      const message = `activate:${body.licenceKey}:${body.timestamp}`;
      if (!verifyEd25519(body.instancePublicKey, message, body.signature))
        return json({ error: "Invalid instance signature." }, 401);
      this.boundKey = body.instancePublicKey;
      return json({ lease: this.lease(), licence: this.summary() });
    }
    if (
      url.pathname === "/v1/refresh" ||
      url.pathname === "/v1/portal" ||
      url.pathname === "/v1/deactivate"
    ) {
      const action = url.pathname.slice(4);
      if (!this.boundKey || instanceIdOf(this.boundKey) !== body.instanceId)
        return json({ error: "Not activated.", code: "not_activated" }, 404);
      if (
        !verifyEd25519(
          this.boundKey,
          `${action}:${body.instanceId}:${body.timestamp}`,
          body.signature,
        )
      )
        return json({ error: "Invalid instance signature." }, 401);
      if (action === "refresh") {
        this.refreshes++;
        return json({ lease: this.lease(), licence: this.summary() });
      }
      if (action === "portal") return json({ url: "https://customer-portal.paddle.com/x" });
      this.boundKey = null;
      return json({ ok: true });
    }
    const match = /^\/v1\/modules\/([a-z-]+)\/(.+)$/.exec(url.pathname);
    if (match) {
      const auth = new Headers(init?.headers).get("Authorization");
      if (!auth?.startsWith("Bearer ")) return json({ error: "Lease required." }, 401);
      const found = this.bundles.get(`${match[1]}/${decodeURIComponent(match[2] ?? "")}`);
      return found ? new Response(found) : json({ error: "Not found." }, 404);
    }
    return json({ error: "Not found." }, 404);
  };

  private lease() {
    if (!this.boundKey) throw new Error("unbound");
    const issuedAt = this.now();
    return jws(
      {
        licenceId: "lic_1",
        instanceId: instanceIdOf(this.boundKey),
        tier: this.tier,
        limits: { printers: this.printers, users: 10 },
        features: [this.tier],
        modules: this.modules,
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + 72 * 3600_000).toISOString(),
      },
      leaseKeys.privateKey,
    );
  }

  private summary() {
    return { tier: this.tier, email: "buyer@example.com", managed: true, validUntil: null };
  }
}

describe("licensing", () => {
  const server = new FakeLicensing();
  let clock = Date.now();
  server.now = () => new Date(clock);
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let admin: string;
  let operator: string;

  const api = (method: "GET" | "POST", url: string, payload?: object, cookie = admin) =>
    ctx.app.inject({ method, url, payload, headers: { cookie } });

  beforeAll(async () => {
    ctx = await createTestApp({
      licensing: {
        url: "https://licensing.test",
        leasePublicKey: leaseKeys.raw,
        modulePublicKey: moduleKeys.raw,
        fetch: server.fetch as typeof fetch,
        now: () => new Date(clock),
      },
    });
    const setup = await ctx.app.inject({
      method: "POST",
      url: "/api/setup",
      payload: {
        email: "admin@example.com",
        displayName: "Admin",
        password: "correct horse battery",
      },
    });
    admin = sessionCookie(setup.headers["set-cookie"]);
    await api("POST", "/api/users", {
      email: "op@example.com",
      displayName: "Op",
      password: "correct horse battery",
      role: "operator",
    });
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "op@example.com", password: "correct horse battery" },
    });
    operator = sessionCookie(login.headers["set-cookie"]);
  });

  afterAll(async () => {
    await ctx.close();
  });

  const waitForModules = async (predicate: (modules: LoadedModule[]) => boolean) => {
    for (let i = 0; i < 100; i++) {
      const { modules } = (await api("GET", "/api/modules")).json();
      if (predicate(modules)) return modules;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("modules did not settle");
  };

  it("starts on Free with a stable instance identity", async () => {
    const status = (await api("GET", "/api/licence")).json();
    expect(status).toMatchObject({
      available: true,
      activated: false,
      tier: "free",
      limits: { printers: 3, users: 2 },
    });
    expect(status.instanceId).toMatch(/^[a-f0-9]{32}$/);
    expect((await api("GET", "/api/modules")).json()).toEqual({ modules: [] });
  });

  it("only lets admins activate, and reports unknown keys", async () => {
    expect(
      (await api("POST", "/api/licence/activate", { licenceKey: LICENCE_KEY }, operator))
        .statusCode,
    ).toBe(403);
    const res = await api("POST", "/api/licence/activate", { licenceKey: "PRIO-XXXXX-XXXXX" });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("licence_unknown");
  });

  it("activates a licence: lease limits apply and the module loads", async () => {
    const res = await api("POST", "/api/licence/activate", {
      licenceKey: LICENCE_KEY.toLowerCase(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      activated: true,
      licenceKey: "•••••-DDDDD",
      tier: "pro",
      limits: { printers: 8, users: 10 },
      email: "buyer@example.com",
      managed: true,
      lastError: null,
    });
    expect((await api("GET", "/api/users")).json().limit).toBe(10);
    const modules = await waitForModules((list) => list.length === 1);
    expect(modules).toEqual([
      { id: "test", version: "1.0.0", web: true, status: "active", error: null },
    ]);
  });

  it("serves module routes, migrations and the web bundle", async () => {
    expect((await api("GET", "/api/modules/test/hello/world")).json()).toEqual({
      hello: "world",
      tier: "pro",
    });
    expect((await api("POST", "/api/modules/test/notes", { text: "x" }, operator)).statusCode).toBe(
      403,
    );
    expect((await api("POST", "/api/modules/test/notes", { text: "first" })).statusCode).toBe(200);
    expect((await api("GET", "/api/modules/test/notes", undefined, operator)).json()).toEqual({
      notes: [{ text: "first" }],
    });
    const [table] = await ctx.db.execute(
      sql`select count(*)::int as n from information_schema.tables where table_schema = 'module_test' and table_name = 'notes'`,
    );
    expect(table?.n).toBe(1);
    const web = await api("GET", "/api/modules/test/web.js");
    expect(web.headers["content-type"]).toContain("javascript");
    expect(web.body).toContain("setup()");
    expect((await api("GET", "/api/modules/test/nope")).statusCode).toBe(404);

    // Modules create orders through the core's order logic, with events.
    const made = (await api("POST", "/api/modules/test/orders", { name: "From a quote" })).json();
    expect(made.created).toMatchObject({ name: "From a quote", customer: "Acme", status: "new" });
    expect(made.updated).toMatchObject({ id: made.created.id, status: "in_progress" });
    expect(made.missing).toBeNull();
    expect((globalThis as { __moduleOrderEvents?: string[] }).__moduleOrderEvents).toContain("From a quote");
    expect((await api("GET", `/api/orders/${made.created.id}`)).json()).toMatchObject({ status: "in_progress" });
    expect(
      (await ctx.app.inject({ method: "GET", url: "/api/modules/test/notes" })).statusCode,
    ).toBe(401);
  });

  it("refuses a module whose signature does not match", async () => {
    server.bundles.set(
      "test/1.0.1",
      bundle(MODULE_SERVER, { version: "1.0.1", key: keypair().privateKey }),
    );
    server.modules = [{ id: "test", version: "1.0.1" }];
    await api("POST", "/api/licence/refresh");
    const modules = await waitForModules((list) => list[0]?.version === "1.0.1");
    expect(modules[0]).toMatchObject({
      status: "error",
      error: "The module signature is invalid.",
    });
    expect((await api("GET", "/api/modules/test/notes")).statusCode).toBe(404);
    expect((await api("GET", "/api/modules/test/web.js")).statusCode).toBe(404);

    server.modules = [{ id: "test", version: "1.0.0" }];
    await api("POST", "/api/licence/refresh");
    await waitForModules((list) => list[0]?.version === "1.0.0" && list[0]?.status === "active");
    // Module data survived the reload.
    expect((await api("GET", "/api/modules/test/notes")).json().notes).toHaveLength(1);
  });

  it("keeps the lease while offline and falls back to Free when it expires", async () => {
    server.offline = true;
    const status = (await api("POST", "/api/licence/refresh")).json();
    expect(status.tier).toBe("pro");
    expect(status.lastError).toMatch(/unreachable/);

    clock += 73 * 3600_000;
    expect((await api("GET", "/api/licence")).json()).toMatchObject({
      tier: "free",
      limits: { printers: 3, users: 2 },
    });
    expect((await api("GET", "/api/users")).json().limit).toBe(2);

    server.offline = false;
    await api("POST", "/api/licence/refresh");
    expect((await api("GET", "/api/licence")).json()).toMatchObject({
      tier: "pro",
      lastError: null,
    });
  });

  it("opens the billing portal and deactivates", async () => {
    expect((await api("POST", "/api/licence/portal")).json()).toEqual({
      url: "https://customer-portal.paddle.com/x",
    });
    const res = await api("POST", "/api/licence/deactivate");
    expect(res.json()).toMatchObject({ activated: false, tier: "free" });
    expect(server.boundKey).toBeNull();
    await waitForModules((list) => list.length === 0);
    expect((await api("GET", "/api/modules/test/notes")).statusCode).toBe(404);
  });
});

describe("licensing without pinned keys", () => {
  it("stays Free and explains that activation needs an official build", async () => {
    const ctx = await createTestApp();
    try {
      const setup = await ctx.app.inject({
        method: "POST",
        url: "/api/setup",
        payload: { email: "a@example.com", displayName: "A", password: "correct horse battery" },
      });
      const cookie = sessionCookie(setup.headers["set-cookie"]);
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/licence/activate",
        payload: { licenceKey: LICENCE_KEY },
        headers: { cookie },
      });
      expect(res.statusCode).toBe(503);
      const status = await ctx.app.inject({
        method: "GET",
        url: "/api/licence",
        headers: { cookie },
      });
      expect(status.json()).toMatchObject({ available: false, tier: "free" });
    } finally {
      await ctx.close();
    }
  });
});
