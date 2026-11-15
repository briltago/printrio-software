import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sameOrigin } from "../src/app.ts";
import { createTestApp, sessionCookie } from "./helpers.ts";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;

beforeAll(async () => {
  ctx = await createTestApp();
  const setup = await ctx.app.inject({
    method: "POST",
    url: "/api/setup",
    payload: { email: "admin@example.com", displayName: "Admin", password: "correct horse battery" },
  });
  cookie = sessionCookie(setup.headers["set-cookie"]);
});

afterAll(async () => {
  await ctx.close();
});

/** A change request as a browser sends it; `headers` describe where the page is. */
const post = (headers: Record<string, string>, url = "/api/printer-groups") =>
  ctx.app.inject({
    method: "POST",
    url,
    headers: { cookie, host: "192.168.1.20:3000", ...headers },
    payload: { name: `Group ${Math.random()}` },
  });

describe("cross-site request protection", () => {
  it("accepts Printrio's own pages over plain HTTP, where browsers send no Sec-Fetch-Site", async () => {
    expect((await post({ origin: "http://192.168.1.20:3000" })).statusCode).toBe(201);
    // Host names are compared without regard to case or a written-out default port.
    expect((await post({ origin: "http://Printrio.local", host: "printrio.local:80" })).statusCode).toBe(201);
    expect((await post({ origin: "https://printrio.example.com:443", host: "printrio.example.com" })).statusCode).toBe(201);
  });

  it("refuses other origins when Sec-Fetch-Site is missing", async () => {
    for (const origin of [
      "http://192.168.1.20:8080", // another service on the same machine
      "http://192.168.1.21:3000",
      "http://evil.example",
      "http://192.168.1.20:3000.evil.example",
      "null", // sandboxed frame or cross-origin redirect
      "not a url",
      "",
    ]) {
      const res = await post({ origin });
      expect(res.statusCode, origin).toBe(403);
      expect(res.json()).toEqual({ error: "Cross-site request refused." });
    }
    // Nothing was created by the refused requests.
    const groups = await ctx.app.inject({ method: "GET", url: "/api/printer-groups", headers: { cookie } });
    expect(groups.json().groups).toHaveLength(3);
  });

  it("covers uploads, body-less requests, sign-in and the WebSocket", async () => {
    const foreign = { origin: "http://192.168.1.20:8080", host: "192.168.1.20:3000" };
    const boundary = "----printrio";
    const upload = await ctx.app.inject({
      method: "POST",
      url: "/api/backups/upload",
      headers: { cookie, ...foreign, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="b.tar.gz"\r\n\r\nx\r\n--${boundary}--\r\n`,
    });
    expect(upload.statusCode).toBe(403);
    const restore = await ctx.app.inject({
      method: "POST",
      url: "/api/backups/printrio-20260101-000000-uploaded-v1.0.0.tar.gz/restore",
      headers: { cookie, ...foreign },
    });
    expect(restore.statusCode).toBe(403);
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: foreign,
      payload: { email: "admin@example.com", password: "correct horse battery" },
    });
    expect(login.statusCode).toBe(403);
    const socket = await ctx.app.inject({
      method: "GET",
      url: "/api/ws",
      headers: { cookie, ...foreign, upgrade: "websocket", connection: "Upgrade" },
    });
    expect(socket.statusCode).toBe(403);
    const remove = await ctx.app.inject({ method: "DELETE", url: "/api/printer-groups/00000000-0000-4000-8000-000000000000", headers: { cookie, ...foreign } });
    expect(remove.statusCode).toBe(403);
  });

  it("keeps refusing what Sec-Fetch-Site marks as foreign, whatever Origin says", async () => {
    for (const site of ["cross-site", "same-site"])
      expect((await post({ "sec-fetch-site": site, origin: "http://192.168.1.20:3000" })).statusCode, site).toBe(403);
  });

  it("trusts Sec-Fetch-Site when the browser sends it, e.g. behind a proxy that rewrites Host", async () => {
    const res = await post({ "sec-fetch-site": "same-origin", origin: "https://printrio.example.com", host: "printrio:3000" });
    expect(res.statusCode).toBe(201);
  });

  it("accepts the host a reverse proxy forwards", async () => {
    const res = await post({ origin: "http://printrio.lan", host: "printrio:3000", "x-forwarded-host": "printrio.lan" });
    expect(res.statusCode).toBe(201);
    expect((await post({ origin: "http://evil.example", host: "printrio:3000", "x-forwarded-host": "printrio.lan" })).statusCode).toBe(403);
  });

  it("leaves clients that are not web pages alone, and reading", async () => {
    // Slicers, scripts and API clients send neither header.
    expect((await post({})).statusCode).toBe(201);
    const read = await ctx.app.inject({
      method: "GET",
      url: "/api/printer-groups",
      headers: { cookie, origin: "http://evil.example", host: "192.168.1.20:3000" },
    });
    expect(read.statusCode).toBe(200);
  });

  it("compares hosts exactly", () => {
    expect(sameOrigin({ host: "a.example" })).toBe(true);
    expect(sameOrigin({ host: "a.example", origin: "http://a.example" })).toBe(true);
    expect(sameOrigin({ host: "a.example:3000", origin: "http://a.example" })).toBe(false);
    expect(sameOrigin({ host: "a.example", origin: "http://a.example.evil.test" })).toBe(false);
    expect(sameOrigin({ host: "a.example", origin: "http://b.example" })).toBe(false);
    expect(sameOrigin({ origin: "http://a.example" })).toBe(false);
    expect(sameOrigin({ host: "[::1]:3000", origin: "http://[::1]:3000" })).toBe(true);
  });
});
