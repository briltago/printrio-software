import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Sso } from "../src/auth/sso.ts";
import { SecretBox } from "../src/crypto.ts";
import { createTestApp, sessionCookie } from "./helpers.ts";

/** A small OpenID Connect provider: discovery, JWKS, token endpoint signing RS256 ID tokens. */
async function fakeProvider() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const state = {
    claims: {} as Record<string, unknown>,
    issuedFor: { nonce: "" },
    lastTokenRequest: "",
  };
  let base = "";
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", base);
    const json = (body: unknown) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/.well-known/openid-configuration")
      return json({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        jwks_uri: `${base}/jwks`,
      });
    if (url.pathname === "/jwks") return json({ keys: [jwk] });
    if (url.pathname === "/token") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        state.lastTokenRequest = body;
        const token = await new SignJWT({ nonce: state.issuedFor.nonce, ...state.claims })
          .setProtectedHeader({ alg: "RS256", kid: "k1" })
          .setIssuer(base)
          .setAudience("printrio-client")
          .setSubject("user-1")
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey);
        json({ id_token: token, access_token: "a" });
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, state, close: () => server.close() };
}

describe("single sign-on (OpenID Connect)", () => {
  let provider: Awaited<ReturnType<typeof fakeProvider>>;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let sso: Sso;
  let available = true;

  beforeAll(async () => {
    provider = await fakeProvider();
  });
  afterAll(() => provider.close());
  beforeEach(async () => {
    ctx = await createTestApp();
    available = true;
    sso = new Sso(ctx.db, new SecretBox("test-secret-test-secret-test-secret"), () => available);
    await sso.save({
      enabled: true,
      issuer: provider.base,
      clientId: "printrio-client",
      clientSecret: "s3cret",
      label: "Company",
      allowedDomains: ["example.com"],
      autoCreate: true,
      publicUrl: "",
    });
  });
  afterEach(async () => {
    await ctx.close();
  });

  const signIn = async (claims: Record<string, unknown>) => {
    const url = new URL(await sso.start("https://farm.example.com"));
    provider.state.issuedFor.nonce = url.searchParams.get("nonce") ?? "";
    provider.state.claims = claims;
    return { url, result: sso.finish("code-1", url.searchParams.get("state") ?? "") };
  };

  it("runs the code flow with PKCE and verifies the ID token", async () => {
    const { url, result } = await signIn({
      email: "Eva@Example.com",
      email_verified: true,
      name: "Eva Nová",
    });
    expect(url.origin).toBe(provider.base);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://farm.example.com/api/auth/sso/callback",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(await result).toEqual({
      email: "eva@example.com",
      name: "Eva Nová",
      autoCreate: true,
      emailVerified: true,
    });
    const sent = new URLSearchParams(provider.state.lastTokenRequest);
    expect(sent.get("code_verifier")).toBeTruthy();
    expect(sent.get("client_secret")).toBe("s3cret");
    // The secret is stored encrypted and never shown.
    expect(sso.dto(await sso.config(), "https://farm.example.com")).toMatchObject({
      hasSecret: true,
      available: true,
    });
    expect(JSON.stringify(sso.dto(await sso.config(), "x"))).not.toContain("s3cret");
  });

  it("refuses replays, foreign domains, unverified e-mail, a wrong nonce and no licence", async () => {
    const first = await signIn({ email: "eva@example.com" });
    await first.result;
    await expect(sso.finish("code-1", first.url.searchParams.get("state") ?? "")).rejects.toThrow(
      "took too long",
    );
    await expect((await signIn({ email: "x@other.org" })).result).rejects.toThrow(
      "other.org cannot sign in",
    );
    await expect(
      (await signIn({ email: "eva@example.com", email_verified: false })).result,
    ).rejects.toThrow("verified e-mail");
    const wrongNonce = await signIn({ email: "eva@example.com" });
    provider.state.issuedFor.nonce = "forged";
    await expect(wrongNonce.result).rejects.toThrow("could not be verified");
    available = false;
    await expect(sso.start("https://farm.example.com")).rejects.toThrow("not enabled");
  });

  it("exposes only what the sign-in page needs and stays off without Business", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/api/auth/sso" })).json()).toEqual({
      enabled: false,
      label: "SSO",
    });
    await ctx.app.inject({
      method: "POST",
      url: "/api/setup",
      payload: { email: "a@example.com", displayName: "A", password: "correct horse battery" },
    });
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "a@example.com", password: "correct horse battery" },
    });
    const cookie = sessionCookie(login.headers["set-cookie"]);
    const settings = await ctx.app.inject({
      method: "GET",
      url: "/api/settings/sso",
      headers: { cookie },
    });
    expect(settings.json()).toMatchObject({
      available: false,
      enabled: true,
      hasSecret: true,
      label: "Company",
    });
    const enable = await ctx.app.inject({
      method: "PUT",
      url: "/api/settings/sso",
      headers: { cookie },
      payload: { enabled: true, issuer: provider.base, clientId: "c", label: "Company" },
    });
    expect(enable.statusCode).toBe(400);
    expect(enable.json().error).toContain("Printrio Business");
    const start = await ctx.app.inject({ method: "GET", url: "/api/auth/sso/start" });
    expect(start.statusCode).toBe(302);
    expect(start.headers.location).toContain("/login?sso_error=");
    // A callback without this browser's state cookie (e.g. a link from someone else's flow) is refused.
    const callback = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/sso/callback?code=c&state=s",
    });
    expect(callback.statusCode).toBe(302);
    expect(decodeURIComponent(callback.headers.location ?? "")).toContain("another browser");
  });
});
