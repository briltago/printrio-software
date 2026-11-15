import { count } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isLocalAddress, newSetupCode, sameSetupCode } from "../src/auth/setup.ts";
import { users } from "../src/db/schema.ts";
import { createTestApp } from "./helpers.ts";

// Counts password hashing, the expensive part of the setup request.
const hashing = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../src/auth/password.ts", async (original) => {
  const real = await original<typeof import("../src/auth/password.ts")>();
  return {
    ...real,
    hashPassword: (password: string) => {
      hashing.calls++;
      return real.hashPassword(password);
    },
  };
});

const admin = {
  email: "admin@example.com",
  displayName: "Admin",
  password: "correct horse battery",
};
const PUBLIC = "203.0.113.50";
const LAN = "192.168.1.30";

let ctx: Awaited<ReturnType<typeof createTestApp>> | undefined;
const start = async (env?: Record<string, string>) => {
  ctx = await createTestApp({ env });
  hashing.calls = 0;
  return ctx;
};
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

const setup = (remoteAddress: string, payload: Record<string, unknown> = admin) =>
  (ctx as NonNullable<typeof ctx>).app.inject({
    method: "POST",
    url: "/api/setup",
    remoteAddress,
    payload,
  });
const status = async (remoteAddress: string) =>
  (
    await (ctx as NonNullable<typeof ctx>).app.inject({
      method: "GET",
      url: "/api/setup/status",
      remoteAddress,
    })
  ).json();
const userCount = async () =>
  Number(
    (await (ctx as NonNullable<typeof ctx>).db.select({ value: count() }).from(users))[0]?.value,
  );

describe("first-run setup protection", () => {
  it("lets the local network set up as before, but not a public address without the code", async () => {
    await start();
    expect(await status(LAN)).toEqual({ setupRequired: true, setupCodeRequired: false });
    expect(await status(PUBLIC)).toEqual({ setupRequired: true, setupCodeRequired: true });

    for (const payload of [
      admin,
      { ...admin, setupCode: "AAAA-BBBB-CCCC" },
      { ...admin, setupCode: "" },
    ]) {
      const refused = await setup(PUBLIC, payload);
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ code: "setup_code_required" });
      expect(refused.headers["set-cookie"]).toBeUndefined();
    }
    expect(await userCount()).toBe(0);
    // A refused attempt costs no password hash.
    expect(hashing.calls).toBe(0);

    expect((await setup(LAN)).statusCode).toBe(201);
    expect(await userCount()).toBe(1);
    expect(await status(PUBLIC)).toEqual({ setupRequired: false, setupCodeRequired: false });
  });

  it("asks everyone for SETUP_CODE when it is configured", async () => {
    await start({ SETUP_CODE: "K7QM-2XPA-9DWT" });
    expect(await status(LAN)).toEqual({ setupRequired: true, setupCodeRequired: true });
    expect((await setup(LAN)).statusCode).toBe(403);
    expect((await setup("127.0.0.1", { ...admin, setupCode: "K7QM-2XPA-9DWX" })).statusCode).toBe(
      403,
    );
    expect(await userCount()).toBe(0);
    // Typed without dashes and in lower case.
    const created = await setup(PUBLIC, { ...admin, setupCode: " k7qm2xpa9dwt " });
    expect(created.statusCode).toBe(201);
    expect(created.headers["set-cookie"]).toBeDefined();
    expect(await userCount()).toBe(1);
  });

  it("answers 409 after setup without hashing a password or reading the request", async () => {
    await start();
    expect((await setup(LAN)).statusCode).toBe(201);
    expect(hashing.calls).toBe(1);
    for (const payload of [
      admin,
      { ...admin, email: "other@example.com" },
      { password: "short" },
      {},
    ]) {
      const again = await setup(PUBLIC, payload);
      expect(again.statusCode).toBe(409);
      expect(again.headers["set-cookie"]).toBeUndefined();
    }
    expect(hashing.calls).toBe(1);
    expect(await userCount()).toBe(1);
  });

  it("rate limits setup attempts per client", async () => {
    await start();
    const codes: number[] = [];
    for (let n = 0; n < 12; n++) codes.push((await setup(PUBLIC)).statusCode);
    expect(codes.slice(0, 10)).toEqual(Array(10).fill(403));
    expect(codes.slice(10)).toEqual([429, 429]);
    // Another client, e.g. the owner on the LAN, is not locked out.
    expect((await setup(LAN)).statusCode).toBe(201);
  });

  it("still creates only one administrator when two set up at once", async () => {
    await start();
    const results = await Promise.all([
      setup(LAN),
      setup("10.0.0.5", { ...admin, email: "second@example.com" }),
    ]);
    expect(results.map((res) => res.statusCode).sort()).toEqual([201, 409]);
    expect(await userCount()).toBe(1);
  });

  it("tells local from public addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.0.10",
      "169.254.1.1",
      "100.64.0.1",
      "100.127.255.254",
      "::1",
      "fd12:3456::1",
      "fe80::1",
      "::ffff:192.168.1.5",
    ])
      expect(isLocalAddress(ip), ip).toBe(true);
    for (const ip of [
      "8.8.8.8",
      "172.32.0.1",
      "172.15.255.255",
      "192.169.0.1",
      "100.128.0.1",
      "100.63.255.255",
      "2001:db8::1",
      "::ffff:8.8.8.8",
      "",
      "not-an-ip",
      undefined,
    ])
      expect(isLocalAddress(ip), String(ip)).toBe(false);
  });

  it("generates codes that cannot be guessed and compares them exactly", () => {
    const code = newSetupCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(newSetupCode()).not.toBe(code);
    expect(sameSetupCode(code.toLowerCase().replaceAll("-", " "), code)).toBe(true);
    expect(sameSetupCode(code.slice(0, -1), code)).toBe(false);
    expect(sameSetupCode(undefined, code)).toBe(false);
    expect(sameSetupCode(12345678, code)).toBe(false);
  });
});
