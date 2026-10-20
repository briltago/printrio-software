import type { JobRecordDto } from "@printrio/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeMoonraker } from "../dev/fake-moonraker.ts";
import { createTestApp, sessionCookie } from "./helpers.ts";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
const fakes: FakeMoonraker[] = [];

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
});

afterAll(async () => {
  await ctx.close();
  await Promise.all(fakes.map((fake) => fake.stop()));
});

const api = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: object) =>
  ctx.app.inject({ method, url, payload, headers: { cookie: admin } });

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Timed out waiting for a condition.");
}

const jobs = async (query = ""): Promise<JobRecordDto[]> =>
  (await api("GET", `/api/jobs${query}`)).json().jobs;

describe("job recording and costs", () => {
  let printerId: string;
  let fake: FakeMoonraker;

  it("records a print with the loaded spool and its cost", async () => {
    await api("PATCH", "/api/settings", {
      costs: { currency: "czk", electricityPrice: 6, defaultPowerWatts: 100 },
    });
    fake = new FakeMoonraker({ tickMs: 0, progressPerTick: 1 });
    fakes.push(fake);
    await fake.start();
    printerId = (
      await api("POST", "/api/printers", { name: "Trident", url: fake.url, powerWatts: 200 })
    ).json().id;
    const filament = (
      await api("POST", "/api/filaments", {
        vendor: "Prusament",
        name: "Galaxy Black",
        material: "PLA",
        colorName: null,
        colorHex: "#222222",
        price: 25,
      })
    ).json();
    const spool = (
      await api("POST", "/api/spools", { filamentId: filament.id, initialWeight: 1000 })
    ).json();
    await api("PUT", `/api/printers/${printerId}/spool`, { spoolId: spool.id });
    await until(
      async () => (await api("GET", "/api/printers")).json().printers[0].status.state,
      (state) => state === "idle",
    );

    await api("POST", `/api/printers/${printerId}/commands`, {
      action: "start_print",
      path: "3DBenchy.gcode",
    });
    const [running] = await until(jobs, (list) => list.length === 1);
    expect(running).toMatchObject({
      status: "printing",
      printerName: "Trident",
      fileName: "3DBenchy.gcode",
      spool: { label: "Prusament Galaxy Black", colorHex: "#222222", material: "PLA" },
      currency: "CZK",
      totalCost: null,
    });

    fake.tick(); // progress reaches 100 % → Klipper reports "complete"
    const [done] = await until(jobs, (list) => list[0]?.status !== "printing");
    expect(done?.status).toBe("completed");
    expect(done?.endedAt).not.toBeNull();
    // Simulator: 1 s and 12.5 mm per tick.
    expect(done?.printSeconds).toBe(1);
    expect(done?.filamentMm).toBe(12.5);
    // 12.5 mm of 1.75 mm PLA ≈ 0.037 g (stored rounded to 0.01 g); 25 CZK per 1000 g.
    expect(done?.filamentGrams).toBe(0.04);
    expect(done?.materialCost).toBeCloseTo(0.0373 * 0.025, 4);
    // 200 W for 1 s at 6 CZK/kWh.
    expect(done?.energyKwh).toBe(0.0001); // stored to 0.1 Wh
    expect(done?.totalCost).toBeGreaterThan(0);
  });

  it("records cancelled prints and lists them with filters", async () => {
    await api("POST", `/api/printers/${printerId}/commands`, {
      action: "start_print",
      path: "parts/bracket_v3.gcode",
    });
    await until(jobs, (list) => list.length === 2);
    await api("POST", `/api/printers/${printerId}/commands`, { action: "cancel" });
    const list = await until(jobs, (all) => all[0]?.status === "cancelled");
    expect(list.map((job) => job.fileName)).toEqual(["parts/bracket_v3.gcode", "3DBenchy.gcode"]);
    expect((await jobs("?status=completed")).map((job) => job.status)).toEqual(["completed"]);
    expect((await api("GET", "/api/jobs?limit=1")).json().total).toBe(2);
    expect((await api("GET", "/api/jobs?status=unknown")).statusCode).toBe(400);
  });

  it("summarises costs by printer and material", async () => {
    const summary = (await api("GET", "/api/costs")).json();
    expect(summary.currency).toBe("CZK");
    expect(summary.totals.jobs).toBe(2);
    expect(summary.byPrinter).toHaveLength(1);
    expect(summary.byPrinter[0]).toMatchObject({ printerId, printerName: "Trident", jobs: 2 });
    expect(summary.byMaterial.map((m: { material: string }) => m.material)).toEqual(["PLA"]);
    expect(summary.jobsWithoutSpool).toBe(0);
    const future = (
      await api("GET", `/api/costs?from=${new Date(Date.now() + 3_600_000).toISOString()}`)
    ).json();
    expect(future.totals.jobs).toBe(0);
  });

  it("keeps the history when a printer is deleted", async () => {
    await api("DELETE", `/api/printers/${printerId}`);
    const list = await jobs();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ printerId: null, printerName: "Trident" });
  });
});

describe("orders", () => {
  let orderId: string;

  it("creates, lists and updates orders", async () => {
    const created = await api("POST", "/api/orders", {
      name: "  Brackets for the workshop ",
      customer: "Novák s.r.o.",
      notes: "",
    });
    expect(created.statusCode).toBe(201);
    orderId = created.json().id;
    await api("POST", "/api/orders", { name: "Personal stuff", status: "done" });
    expect((await api("POST", "/api/orders", { name: " " })).statusCode).toBe(400);

    const all = (await api("GET", "/api/orders")).json().orders;
    expect(all.map((o: { name: string }) => o.name)).toEqual([
      "Personal stuff",
      "Brackets for the workshop",
    ]);
    expect(all[1]).toMatchObject({
      customer: "Novák s.r.o.",
      status: "new",
      notes: null,
      jobCount: 0,
      totalCost: 0,
      currency: "CZK",
    });
    const done = (await api("GET", "/api/orders?status=done")).json().orders;
    expect(done).toHaveLength(1);

    await api("PATCH", `/api/orders/${orderId}`, { status: "in_progress" });
    const detail = (await api("GET", `/api/orders/${orderId}`)).json();
    expect(detail).toMatchObject({ status: "in_progress", customer: "Novák s.r.o.", jobs: [] });
    expect((await api("PATCH", `/api/orders/${orderId}`, { status: "shipped" })).statusCode).toBe(
      400,
    );
  });

  it("links prints and sums their cost", async () => {
    const list = await jobs();
    for (const job of list) {
      expect((await api("PUT", `/api/jobs/${job.id}/order`, { orderId })).statusCode).toBe(200);
    }
    const detail = (await api("GET", `/api/orders/${orderId}`)).json();
    expect(detail.jobCount).toBe(list.length);
    expect(detail.jobs.map((j: JobRecordDto) => j.orderId)).toEqual(list.map(() => orderId));
    const expected = list.reduce((sum, job) => sum + (job.totalCost ?? 0), 0);
    expect(detail.totalCost).toBeCloseTo(expected, 6);
    expect(await jobs("?orderId=none")).toEqual([]);

    const first = list[0]?.id;
    await api("PUT", `/api/jobs/${first}/order`, { orderId: null });
    expect((await jobs("?orderId=none")).map((j) => j.id)).toEqual([first]);
    expect(
      (
        await api("PUT", `/api/jobs/${first}/order`, {
          orderId: "00000000-0000-4000-8000-000000000000",
        })
      ).statusCode,
    ).toBe(400);
  });

  it("keeps prints when an order is deleted", async () => {
    await api("DELETE", `/api/orders/${orderId}`);
    expect((await api("GET", `/api/orders/${orderId}`)).statusCode).toBe(404);
    expect((await jobs()).every((job) => job.orderId === null)).toBe(true);
  });
});
