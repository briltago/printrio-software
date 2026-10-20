import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { InventoryDto } from "@printrio/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, sessionCookie } from "./helpers.ts";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let operator: string;

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
  await ctx.app.inject({
    method: "POST",
    url: "/api/users",
    headers: { cookie: admin },
    payload: {
      email: "op@example.com",
      displayName: "Operator",
      password: "operator password",
      role: "operator",
    },
  });
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "op@example.com", password: "operator password" },
  });
  operator = sessionCookie(login.headers["set-cookie"]);
});

afterAll(async () => {
  await ctx.close();
});

const api = (
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  payload?: object,
  cookie = admin,
) => ctx.app.inject({ method, url, payload, headers: { cookie } });
const inventory = async (): Promise<InventoryDto> => (await api("GET", "/api/inventory")).json();

describe("filament inventory", () => {
  it("creates filaments and spools with sensible defaults", async () => {
    const filament = await api(
      "POST",
      "/api/filaments",
      {
        vendor: "Prusament",
        name: "Galaxy Black",
        material: "PETG",
        colorName: "Galaxy black",
        colorHex: "#1A1A2E",
        spoolWeight: 1000,
        emptySpoolWeight: 200,
        price: 29.99,
      },
      operator,
    );
    expect(filament.statusCode).toBe(201);
    const filamentId = filament.json().id;
    const spool = await api("POST", "/api/spools", { filamentId, initialWeight: 1000 }, operator);
    expect(spool.statusCode).toBe(201);

    const { filaments, spools } = await inventory();
    expect(filaments[0]).toMatchObject({
      material: "PETG",
      colorHex: "#1a1a2e",
      density: 1.27,
      diameter: 1.75,
      spoolCount: 1,
    });
    expect(spools[0]).toMatchObject({
      remainingWeight: 1000,
      emptySpoolWeight: 200,
      price: 29.99,
      archived: false,
      printerIds: [],
    });
    expect(
      (await api("POST", "/api/filaments", { name: "", material: "PLA", colorHex: null }))
        .statusCode,
    ).toBe(400);
    expect((await api("POST", "/api/spools", { filamentId, initialWeight: 0 })).statusCode).toBe(
      400,
    );
  });

  it("weighs, edits and archives spools", async () => {
    const { spools } = await inventory();
    const id = spools[0]?.id;
    expect(
      (await api("PATCH", `/api/spools/${id}`, { measuredGrossWeight: 650 }, operator)).statusCode,
    ).toBe(200);
    expect((await inventory()).spools[0]?.remainingWeight).toBe(450);
    await api("PATCH", `/api/spools/${id}`, { remainingWeight: 5000 });
    expect((await inventory()).spools[0]?.remainingWeight).toBe(1000);
    await api("PATCH", `/api/spools/${id}`, { location: "Shelf A", notes: "  " });
    expect((await inventory()).spools[0]).toMatchObject({ location: "Shelf A", notes: null });
  });

  it("assigns spools to printers and unloads them when archived", async () => {
    const printer = (
      await api("POST", "/api/printers", { name: "P1", url: "http://127.0.0.1:1" })
    ).json();
    const { spools } = await inventory();
    const spoolId = spools[0]?.id;
    expect(
      (await api("PUT", `/api/printers/${printer.id}/spool`, { spoolId }, operator)).statusCode,
    ).toBe(200);
    const listed = (await api("GET", "/api/printers")).json().printers;
    expect(listed[0].activeSpoolId).toBe(spoolId);
    expect((await inventory()).spools[0]?.printerIds).toEqual([printer.id]);

    await api("PATCH", `/api/spools/${spoolId}`, { archived: true });
    expect((await api("GET", "/api/printers")).json().printers[0].activeSpoolId).toBeNull();
    expect((await api("PUT", `/api/printers/${printer.id}/spool`, { spoolId })).statusCode).toBe(
      400,
    );
    expect((await inventory()).filaments[0]?.spoolCount).toBe(0);
    await api("DELETE", `/api/printers/${printer.id}`);
  });

  it("keeps deletion for admins and protects filaments in use", async () => {
    const { spools, filaments } = await inventory();
    expect(
      (await api("DELETE", `/api/spools/${spools[0]?.id}`, undefined, operator)).statusCode,
    ).toBe(403);
    expect((await api("DELETE", `/api/filaments/${filaments[0]?.id}`)).statusCode).toBe(409);
    expect((await api("DELETE", `/api/spools/${spools[0]?.id}`)).statusCode).toBe(204);
    expect((await api("DELETE", `/api/filaments/${filaments[0]?.id}`)).statusCode).toBe(204);
  });
});

describe("Spoolman import", () => {
  let spoolman: Server;
  let url: string;
  let response: unknown;

  beforeAll(async () => {
    spoolman = createServer((req, res) => {
      if (req.url?.startsWith("/api/v1/spool")) {
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(response));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => spoolman.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(spoolman.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => spoolman.close(() => resolve())));

  const filament = {
    id: 3,
    name: "PolyTerra Cotton White",
    vendor: { id: 1, name: "Polymaker" },
    material: "PLA",
    color_hex: "F5F5F0",
    diameter: 1.75,
    density: 1.31,
    weight: 1000,
    spool_weight: 140,
    price: 22,
  };

  it("imports spools and updates them on a second run", async () => {
    response = [
      {
        id: 1,
        filament,
        remaining_weight: 820,
        used_weight: 180,
        location: "Dry box",
        lot_nr: "A12",
        archived: false,
      },
      {
        id: 2,
        filament,
        initial_weight: 1000,
        used_weight: 1000,
        archived: true,
        comment: "empty",
      },
    ];
    expect((await api("POST", "/api/spools/import/spoolman", { url }, operator)).statusCode).toBe(
      403,
    );
    const first = await api("POST", "/api/spools/import/spoolman", { url: `${url}/` });
    expect(first.json()).toEqual({ filaments: 1, spoolsCreated: 2, spoolsUpdated: 0 });

    const { filaments, spools } = await inventory();
    expect(filaments).toHaveLength(1);
    expect(filaments[0]).toMatchObject({
      vendor: "Polymaker",
      name: "PolyTerra Cotton White",
      colorHex: "#f5f5f0",
      density: 1.31,
      emptySpoolWeight: 140,
    });
    expect(
      spools.map((s) => [s.initialWeight, s.remainingWeight, s.archived, s.location, s.lot]),
    ).toEqual([
      [1000, 820, false, "Dry box", "A12"],
      [1000, 0, true, null, null],
    ]);

    response = [{ id: 1, filament, remaining_weight: 500, used_weight: 500 }];
    const second = (await api("POST", "/api/spools/import/spoolman", { url })).json();
    expect(second).toEqual({ filaments: 1, spoolsCreated: 0, spoolsUpdated: 1 });
    const updated = (await inventory()).spools.find((spool) => !spool.archived);
    expect(updated?.remainingWeight).toBe(500);
  });

  it("reports addresses that are not Spoolman", async () => {
    response = { hello: "world" };
    const res = await api("POST", "/api/spools/import/spoolman", { url });
    expect(res.statusCode).toBe(502);
    expect(
      (await api("POST", "/api/spools/import/spoolman", { url: "http://127.0.0.1:1" })).statusCode,
    ).toBe(502);
    expect((await api("POST", "/api/spools/import/spoolman", { url: "ftp://x" })).statusCode).toBe(
      400,
    );
  });
});
