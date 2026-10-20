import { DEFAULT_SETTINGS, NAV_ITEM_IDS, sidebarPreset } from "@printrio/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, sessionCookie } from "./helpers.ts";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let adminId: string;

beforeAll(async () => {
  ctx = await createTestApp();
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
  adminId = (
    await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: admin } })
  ).json().id;
});

afterAll(async () => {
  await ctx.close();
});

const api = (
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
  cookie = admin,
) => ctx.app.inject({ method, url, payload, headers: { cookie } });

describe("workspace settings", () => {
  it("starts with onboarding pending and the single-printer sidebar", async () => {
    expect((await api("GET", "/api/settings")).json()).toEqual({
      onboardingCompleted: false,
      usageMode: "single",
      defaultView: "auto",
      sidebar: sidebarPreset("single"),
      costs: DEFAULT_SETTINGS.costs,
    });
  });

  it("saves the usage mode, sidebar order/visibility and default view", async () => {
    const sidebar = [...NAV_ITEM_IDS].reverse().map((id) => ({ id, visible: id !== "jobs" }));
    const res = await api("PATCH", "/api/settings", {
      usageMode: "farm",
      defaultView: "fleet",
      sidebar,
      onboardingCompleted: true,
    });
    expect(res.statusCode).toBe(200);
    expect((await api("GET", "/api/settings")).json()).toEqual({
      onboardingCompleted: true,
      usageMode: "farm",
      defaultView: "fleet",
      sidebar,
      costs: DEFAULT_SETTINGS.costs,
    });
  });

  it("saves cost settings and validates them", async () => {
    const res = await api("PATCH", "/api/settings", {
      costs: { currency: "czk", electricityPrice: 6.5, defaultPowerWatts: 150 },
    });
    expect(res.json().costs).toEqual({
      currency: "CZK",
      electricityPrice: 6.5,
      defaultPowerWatts: 150,
    });
    const bad = await api("PATCH", "/api/settings", {
      costs: { currency: "euro", electricityPrice: 6.5, defaultPowerWatts: 150 },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("rejects an invalid sidebar", async () => {
    expect(
      (await api("PATCH", "/api/settings", { sidebar: [{ id: "printers", visible: true }] }))
        .statusCode,
    ).toBe(400);
  });

  it("requires a session to read", async () => {
    expect((await api("GET", "/api/settings", undefined, "")).statusCode).toBe(401);
  });
});

describe("user management", () => {
  let operatorId: string;
  let operator: string;

  it("creates an operator who can sign in but cannot manage users or settings", async () => {
    const res = await api("POST", "/api/users", {
      email: "op@example.com",
      displayName: "Op",
      password: "operator password",
      role: "operator",
    });
    expect(res.statusCode).toBe(201);
    operatorId = res.json().id;
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "op@example.com", password: "operator password" },
    });
    operator = sessionCookie(login.headers["set-cookie"]);
    expect((await api("GET", "/api/users", undefined, operator)).statusCode).toBe(403);
    expect(
      (await api("PATCH", "/api/settings", { defaultView: "auto" }, operator)).statusCode,
    ).toBe(403);
    expect((await api("GET", "/api/settings", undefined, operator)).statusCode).toBe(200);
  });

  it("enforces the Free plan user limit", async () => {
    const res = await api("POST", "/api/users", {
      email: "third@example.com",
      displayName: "Third",
      password: "third password!",
      role: "operator",
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("user_limit");
    expect((await api("GET", "/api/users")).json().limit).toBe(2);
  });

  it("keeps at least one administrator and protects the current account", async () => {
    expect((await api("PATCH", `/api/users/${adminId}`, { role: "operator" })).statusCode).toBe(
      409,
    );
    expect((await api("DELETE", `/api/users/${adminId}`)).statusCode).toBe(409);
  });

  it("signs a user out everywhere when an admin resets their password", async () => {
    expect(
      (await api("PATCH", `/api/users/${operatorId}`, { password: "a brand new password" }))
        .statusCode,
    ).toBe(200);
    expect((await api("GET", "/api/auth/me", undefined, operator)).statusCode).toBe(401);
  });

  it("deletes users", async () => {
    expect((await api("DELETE", `/api/users/${operatorId}`)).statusCode).toBe(200);
    expect((await api("GET", "/api/users")).json().users).toHaveLength(1);
  });
});
