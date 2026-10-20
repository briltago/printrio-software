import type { JobRecordDto, QueueItemDto } from "@printrio/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeMoonraker } from "../dev/fake-moonraker.ts";
import { createTestApp, sessionCookie } from "./helpers.ts";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let fake: FakeMoonraker;
let printerId: string;

const api = (method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH", url: string, payload?: object) =>
  ctx.app.inject({ method, url, payload, headers: { cookie: admin } });
const items = async (): Promise<QueueItemDto[]> =>
  (await api("GET", `/api/printers/${printerId}/queue`)).json().items;

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Timed out waiting for a condition.");
}
const state = async () => (await api("GET", "/api/printers")).json().printers[0].status.state;

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
  fake = new FakeMoonraker({ tickMs: 0, progressPerTick: 1 });
  await fake.start();
  printerId = (await api("POST", "/api/printers", { name: "Queue", url: fake.url })).json().id;
  await until(state, (value) => value === "idle");
});

afterAll(async () => {
  await ctx.close();
  await fake.stop();
});

describe("per-printer queue", () => {
  it("adds files (with copies and an order), lists and reorders them", async () => {
    const order = (await api("POST", "/api/orders", { name: "Café" })).json();
    expect(
      (
        await api("POST", `/api/printers/${printerId}/queue`, {
          path: "3DBenchy.gcode",
          orderId: order.id,
        })
      ).statusCode,
    ).toBe(201);
    await api("POST", `/api/printers/${printerId}/queue`, {
      path: "parts/bracket_v3.gcode",
      copies: 2,
    });
    let list = await items();
    expect(list.map((item) => item.path)).toEqual([
      "3DBenchy.gcode",
      "parts/bracket_v3.gcode",
      "parts/bracket_v3.gcode",
    ]);
    expect(list[0]).toMatchObject({ orderName: "Café", addedBy: "Admin" });

    const ids = list.map((item) => item.id);
    const reordered = await api("PUT", `/api/printers/${printerId}/queue/order`, {
      ids: [ids[1], ids[0], ids[2]],
    });
    expect(reordered.json().items.map((item: QueueItemDto) => item.id)).toEqual([
      ids[1],
      ids[0],
      ids[2],
    ]);
    expect(
      (await api("PUT", `/api/printers/${printerId}/queue/order`, { ids: [ids[0]] })).statusCode,
    ).toBe(400);
    expect(
      (await api("POST", `/api/printers/${printerId}/queue`, { path: "../x.gcode" })).statusCode,
    ).toBe(400);

    await api("DELETE", `/api/printers/${printerId}/queue/${ids[2]}`);
    list = await items();
    expect(list).toHaveLength(2);
    // Benchy (with the order) first again.
    await api("PUT", `/api/printers/${printerId}/queue/order`, { ids: [ids[0], ids[1]] });
  });

  it("starts the next item by hand and links the print to its order", async () => {
    const started = await api("POST", `/api/printers/${printerId}/queue/start`);
    expect(started.statusCode).toBe(200);
    expect(started.json().started).toBe("3DBenchy.gcode");
    expect((await items()).map((item) => item.path)).toEqual(["parts/bracket_v3.gcode"]);
    await until(state, (value) => value === "printing");
    expect((await api("POST", `/api/printers/${printerId}/queue/start`)).statusCode).toBe(409);

    const [job] = await until(
      async (): Promise<JobRecordDto[]> => (await api("GET", "/api/jobs")).json().jobs,
      (list) => list.length === 1,
    );
    const orders = (await api("GET", "/api/orders")).json().orders;
    expect(job?.orderId).toBe(orders[0].id);

    fake.tick();
    await until(state, (value) => value === "idle");
    const next = await api("POST", `/api/printers/${printerId}/queue/start`);
    expect(next.json().started).toBe("parts/bracket_v3.gcode");
    const jobs = await until(
      async (): Promise<JobRecordDto[]> => (await api("GET", "/api/jobs")).json().jobs,
      (list) => list.length === 2,
    );
    expect(jobs[0]?.orderId).toBeNull();
    expect(await items()).toEqual([]);
    expect((await api("POST", `/api/printers/${printerId}/queue/start`)).statusCode).toBe(409);
  });
});
