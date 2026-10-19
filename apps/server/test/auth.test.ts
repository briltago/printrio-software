import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, sessionCookie } from "./helpers.ts";

let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx.close();
});

const admin = {
  email: "Admin@Example.com",
  displayName: "Admin",
  password: "correct horse battery",
};

describe("health", () => {
  it("reports ok when the database is reachable", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("first-run setup and authentication", () => {
  it("requires setup on an empty instance", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/setup/status" });
    expect(res.json()).toEqual({ setupRequired: true });
  });

  it("rejects a weak password", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/setup",
      payload: { ...admin, password: "short" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("creates the initial admin and signs them in", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/api/setup", payload: admin });
    expect(res.statusCode).toBe(201);

    const me = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: sessionCookie(res.headers["set-cookie"]) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: admin.email, role: "admin" });
  });

  it("closes setup once a user exists", async () => {
    const status = await ctx.app.inject({ method: "GET", url: "/api/setup/status" });
    expect(status.json()).toEqual({ setupRequired: false });

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/setup",
      payload: { ...admin, email: "other@example.com" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects a wrong password", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: admin.email, password: "wrong password!!" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("logs in case-insensitively by email and logs out", async () => {
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "admin@example.com", password: admin.password },
    });
    expect(login.statusCode).toBe(200);
    const cookie = sessionCookie(login.headers["set-cookie"]);
    expect(login.headers["set-cookie"]).toMatch(/HttpOnly/);

    const logout = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(200);

    const me = await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it("rejects requests without a session", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/auth/me" });
    expect(res.statusCode).toBe(401);
  });
});
