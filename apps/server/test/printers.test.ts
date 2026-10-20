import type { AddressInfo } from "node:net";
import type { Printer, PrinterStatusDto, RealtimeMessage } from "@printrio/shared";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { FakeMoonraker } from "../dev/fake-moonraker.ts";
import { createTestApp, sessionCookie } from "./helpers.ts";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let operator: string;
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

afterEach(async () => {
  // Delete through the API so the manager drops its connections too.
  for (const printer of await listPrinters()) await api("DELETE", `/api/printers/${printer.id}`);
  await ctx.db.execute(sql`delete from printer_groups`);
  await Promise.all(fakes.splice(0).map((fake) => fake.stop()));
});

afterAll(async () => {
  await ctx.close();
});

async function fakePrinter(options: ConstructorParameters<typeof FakeMoonraker>[0] = {}) {
  const fake = new FakeMoonraker({ tickMs: 0, ...options });
  fakes.push(fake);
  await fake.start();
  return fake;
}

const api = (
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  payload?: object,
  cookie = admin,
) => ctx.app.inject({ method, url, payload, headers: { cookie } });

async function listPrinters(cookie = admin): Promise<Printer[]> {
  return (await api("GET", "/api/printers", undefined, cookie)).json().printers;
}

async function waitForState(id: string, state: PrinterStatusDto["state"]) {
  for (let i = 0; i < 100; i++) {
    const printer = (await listPrinters()).find((p) => p.id === id);
    if (printer?.status.state === state) return printer;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Printer never reached ${state}`);
}

describe("connection test", () => {
  it("reports hostname and Klipper state for a reachable printer", async () => {
    const fake = await fakePrinter({ hostname: "voron" });
    const res = await api("POST", "/api/printers/test", { url: fake.url });
    expect(res.json()).toEqual({ ok: true, hostname: "voron", klippyState: "ready", error: null });
  });

  it("explains failures instead of throwing", async () => {
    const res = await api("POST", "/api/printers/test", { url: "http://127.0.0.1:1" });
    expect(res.json()).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Nothing is listening|No response/),
    });
  });

  it("is admin only", async () => {
    expect(
      (await api("POST", "/api/printers/test", { url: "http://127.0.0.1:1" }, operator)).statusCode,
    ).toBe(403);
  });
});

describe("printers", () => {
  it("adds a printer, connects it and exposes live status", async () => {
    const fake = await fakePrinter({ printing: { fileName: "benchy.gcode", progress: 0.5 } });
    const res = await api("POST", "/api/printers", {
      name: "Voron 2.4",
      url: `${fake.url}/`,
      tags: ["petg"],
    });
    expect(res.statusCode).toBe(201);
    const created = res.json() as Printer;
    expect(created).toMatchObject({
      name: "Voron 2.4",
      url: fake.url,
      tags: ["petg"],
      hasApiKey: false,
      withinLimit: true,
    });
    const printing = await waitForState(created.id, "printing");
    expect(printing.status.job?.fileName).toBe("benchy.gcode");
  });

  it("stores API keys encrypted and never returns them", async () => {
    const fake = await fakePrinter({ apiKey: "moonraker-secret" });
    const res = await api("POST", "/api/printers", {
      name: "Secure",
      url: fake.url,
      apiKey: "moonraker-secret",
    });
    expect(JSON.stringify(res.json())).not.toContain("moonraker-secret");
    expect(res.json().hasApiKey).toBe(true);
    const stored = await ctx.db.execute(sql`select api_key_encrypted from printers`);
    expect(String(stored[0]?.api_key_encrypted)).not.toContain("moonraker-secret");
    await waitForState(res.json().id, "idle");
  });

  it("enforces the Free plan printer limit", async () => {
    const fake = await fakePrinter();
    for (let i = 0; i < 3; i++) {
      expect(
        (await api("POST", "/api/printers", { name: `P${i}`, url: fake.url })).statusCode,
      ).toBe(201);
    }
    const res = await api("POST", "/api/printers", { name: "P4", url: fake.url });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("printer_limit");
  });

  it("only lets admins change printers", async () => {
    expect(
      (await api("POST", "/api/printers", { name: "X", url: "http://127.0.0.1:1" }, operator))
        .statusCode,
    ).toBe(403);
  });

  it("runs commands from operators and forwards G-code", async () => {
    const fake = await fakePrinter({ printing: { fileName: "cube.gcode", progress: 0.2 } });
    const { id } = (await api("POST", "/api/printers", { name: "Ender", url: fake.url })).json();
    await waitForState(id, "printing");
    expect(
      (await api("POST", `/api/printers/${id}/commands`, { action: "pause" }, operator)).statusCode,
    ).toBe(200);
    await waitForState(id, "paused");
    await api(
      "POST",
      `/api/printers/${id}/commands`,
      { action: "gcode", script: "M117 Hello" },
      operator,
    );
    expect(fake.gcode).toEqual(["M117 Hello"]);
    expect(
      (await api("POST", `/api/printers/${id}/commands`, { action: "explode" })).statusCode,
    ).toBe(400);
  });

  it("returns 409 for commands to a disconnected printer", async () => {
    const { id } = (
      await api("POST", "/api/printers", { name: "Gone", url: "http://127.0.0.1:1" })
    ).json();
    expect(
      (await api("POST", `/api/printers/${id}/commands`, { action: "pause" })).statusCode,
    ).toBe(409);
  });

  it("reconnects after the printer host comes back", async () => {
    const fake = await fakePrinter();
    const { id } = (await api("POST", "/api/printers", { name: "Flaky", url: fake.url })).json();
    await waitForState(id, "idle");
    fake.dropConnections();
    await waitForState(id, "idle");
  });

  it("updates, reorders and deletes printers", async () => {
    const fake = await fakePrinter();
    const a = (await api("POST", "/api/printers", { name: "A", url: fake.url })).json();
    const b = (await api("POST", "/api/printers", { name: "B", url: fake.url })).json();
    expect(
      (await api("PATCH", `/api/printers/${a.id}`, { name: "A2", tags: ["pla"] })).json(),
    ).toMatchObject({ name: "A2", tags: ["pla"] });
    await api("PUT", "/api/printers/order", { ids: [b.id, a.id] });
    expect((await listPrinters()).map((p) => p.name)).toEqual(["B", "A2"]);
    expect((await api("DELETE", `/api/printers/${a.id}`)).statusCode).toBe(200);
    expect((await listPrinters()).map((p) => p.name)).toEqual(["B"]);
  });
});

describe("temperatures and webcams", () => {
  it("sets temperatures through commands and validates heater names and range", async () => {
    const fake = await fakePrinter();
    const { id } = (await api("POST", "/api/printers", { name: "Heat", url: fake.url })).json();
    await waitForState(id, "idle");
    expect(
      (
        await api(
          "POST",
          `/api/printers/${id}/commands`,
          { action: "set_temperature", heater: "extruder", target: 215 },
          operator,
        )
      ).statusCode,
    ).toBe(200);
    expect(fake.gcode).toEqual(["SET_HEATER_TEMPERATURE HEATER=extruder TARGET=215"]);
    expect(
      (
        await api("POST", `/api/printers/${id}/commands`, {
          action: "set_temperature",
          heater: "extruder; G28",
          target: 200,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await api("POST", `/api/printers/${id}/commands`, {
          action: "set_temperature",
          heater: "extruder",
          target: 900,
        })
      ).statusCode,
    ).toBe(400);
  });

  it("returns temperature history and webcams without exposing camera URLs", async () => {
    const fake = await fakePrinter();
    const { id } = (await api("POST", "/api/printers", { name: "Cam", url: fake.url })).json();
    await waitForState(id, "idle");
    const history = (
      await api("GET", `/api/printers/${id}/temperatures`, undefined, operator)
    ).json();
    expect(history.series.map((s: { name: string }) => s.name)).toEqual(["extruder", "heater_bed"]);
    const webcams = (await api("GET", `/api/printers/${id}/webcams`, undefined, operator)).json();
    expect(webcams).toEqual({
      webcams: [
        {
          index: 0,
          name: "Nozzle cam",
          service: "mjpegstreamer",
          mode: "mjpeg",
          flipHorizontal: false,
          flipVertical: false,
          rotation: 0,
        },
      ],
    });
    expect(JSON.stringify(webcams)).not.toContain(fake.url);
  });

  it("proxies webcam snapshots for signed-in users only", async () => {
    const fake = await fakePrinter();
    const { id } = (await api("POST", "/api/printers", { name: "Snap", url: fake.url })).json();
    await waitForState(id, "idle");
    const snapshot = await api(
      "GET",
      `/api/printers/${id}/webcams/0/snapshot`,
      undefined,
      operator,
    );
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.headers["content-type"]).toBe("image/jpeg");
    expect(snapshot.rawPayload.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(
      (await api("GET", `/api/printers/${id}/webcams/0/snapshot`, undefined, "")).statusCode,
    ).toBe(401);
    expect((await api("GET", `/api/printers/${id}/webcams/5/snapshot`)).statusCode).toBe(404);
  });

  it("returns 409 for media of a disconnected printer", async () => {
    const { id } = (
      await api("POST", "/api/printers", { name: "Off", url: "http://127.0.0.1:9" })
    ).json();
    expect((await api("GET", `/api/printers/${id}/temperatures`)).statusCode).toBe(409);
  });
});

describe("motion and tuning commands", () => {
  it("validates motion and tuning commands before they reach the printer", async () => {
    const fake = await fakePrinter();
    const { id } = (await api("POST", "/api/printers", { name: "Move", url: fake.url })).json();
    await waitForState(id, "idle");
    const send = (body: object) => api("POST", `/api/printers/${id}/commands`, body, operator);
    expect((await send({ action: "home", axes: [] })).statusCode).toBe(200);
    expect((await send({ action: "jog", axis: "z", distance: 0.1 })).statusCode).toBe(200);
    expect((await send({ action: "jog", axis: "z", distance: 0 })).statusCode).toBe(400);
    expect((await send({ action: "jog", axis: "e", distance: 5 })).statusCode).toBe(400);
    expect((await send({ action: "flow_factor", factor: 3 })).statusCode).toBe(400);
    expect((await send({ action: "fan_speed", fan: "fan", speed: 1.5 })).statusCode).toBe(400);
    expect((await send({ action: "fan_speed", fan: "fan; M112", speed: 0.5 })).statusCode).toBe(
      400,
    );
    expect((await send({ action: "exclude_object", name: "A;M112" })).statusCode).toBe(400);
    expect(fake.gcode).toEqual(["G28", "G91\nG1 Z0.1 F600\nG90"]);
  });

  it("returns the printer's error when a move is not allowed", async () => {
    const fake = await fakePrinter();
    const { id } = (await api("POST", "/api/printers", { name: "Unhomed", url: fake.url })).json();
    await waitForState(id, "idle");
    const res = await api("POST", `/api/printers/${id}/commands`, {
      action: "jog",
      axis: "x",
      distance: 10,
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/Must home axis first/);
  });
});

describe("files and history", () => {
  async function connectedPrinter() {
    const fake = await fakePrinter();
    const { id } = (await api("POST", "/api/printers", { name: "Files", url: fake.url })).json();
    await waitForState(id, "idle");
    return { fake, id };
  }
  const multipart = (name: string, content: string) => {
    const boundary = "----printrio";
    return {
      boundary,
      body: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n${content}\r\n--${boundary}--\r\n`,
    };
  };
  const upload = (id: string, name: string, query = "") => {
    const { boundary, body } = multipart(name, "G28\nG1 X10\n");
    return ctx.app.inject({
      method: "POST",
      url: `/api/printers/${id}/files${query}`,
      headers: { cookie: operator, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
  };

  it("lists files and directories without exposing printer paths for thumbnails", async () => {
    const { id } = await connectedPrinter();
    const listing = (await api("GET", `/api/printers/${id}/files`, undefined, operator)).json();
    expect(listing.directories).toEqual(["parts"]);
    expect(listing.files.find((f: { name: string }) => f.name === "3DBenchy.gcode")).toMatchObject({
      hasThumbnail: true,
      estimatedSeconds: 5820,
    });
    expect(JSON.stringify(listing)).not.toContain(".thumbs");
    expect(
      (await api("GET", `/api/printers/${id}/files?dir=parts`, undefined, operator)).json().files[0]
        .path,
    ).toBe("parts/bracket_v3.gcode");
  });

  it("serves thumbnails looked up by G-code file and rejects path traversal", async () => {
    const { id } = await connectedPrinter();
    const thumb = await api(
      "GET",
      `/api/printers/${id}/files/thumbnail?path=parts/bracket_v3.gcode`,
      undefined,
      operator,
    );
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers["content-type"]).toBe("image/png");
    expect(
      (await api("GET", `/api/printers/${id}/files/thumbnail?path=../printer.cfg`)).statusCode,
    ).toBe(400);
    expect((await api("GET", `/api/printers/${id}/files?dir=../config`)).statusCode).toBe(400);
    expect(
      (await api("GET", `/api/printers/${id}/files/thumbnail?path=missing.gcode`)).statusCode,
    ).toBe(404);
  });

  it("uploads G-code (optionally starting the print) and rejects other files", async () => {
    const { fake, id } = await connectedPrinter();
    expect((await upload(id, "cube.gcode", "?dir=parts")).statusCode).toBe(201);
    expect(fake.uploads).toEqual(["parts/cube.gcode"]);
    expect((await upload(id, "evil.sh")).statusCode).toBe(400);
    const started = await upload(id, "go.gcode", "?print=true");
    expect(started.json()).toEqual({ path: "go.gcode", printing: true });
    await waitForState(id, "printing");
  });

  it("starts prints by path and deletes files", async () => {
    const { id } = await connectedPrinter();
    expect(
      (
        await api("POST", `/api/printers/${id}/commands`, {
          action: "start_print",
          path: "../x.gcode",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await api("DELETE", `/api/printers/${id}/files?path=3DBenchy.gcode`, undefined, operator))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await api(
          "POST",
          `/api/printers/${id}/commands`,
          { action: "start_print", path: "enclosure_panel_left.gcode" },
          operator,
        )
      ).statusCode,
    ).toBe(200);
    await waitForState(id, "printing");
  });

  it("returns print history with totals", async () => {
    const { id } = await connectedPrinter();
    const history = (
      await api("GET", `/api/printers/${id}/history?limit=2`, undefined, operator)
    ).json();
    expect(history.jobs.map((j: { status: string }) => j.status)).toEqual(["error", "cancelled"]);
    expect(history.totals.jobs).toBe(3);
    expect((await api("GET", `/api/printers/${id}/history?limit=999`)).statusCode).toBe(400);
  });

  it("returns the console backlog, macros and G-code commands", async () => {
    const { id } = await connectedPrinter();
    await api("POST", `/api/printers/${id}/commands`, { action: "gcode", script: "M117 Hi" });
    const backlog = (await api("GET", `/api/printers/${id}/console`, undefined, operator)).json();
    expect(backlog.entries.at(0)).toMatchObject({ kind: "command", message: "M117 Hi" });
    expect(Number.isNaN(Date.parse(backlog.entries.at(0).time))).toBe(false);
    expect((await api("GET", `/api/printers/${id}/console?count=0`)).statusCode).toBe(400);

    const list = (await api("GET", `/api/printers/${id}/macros`, undefined, operator)).json();
    expect(list.macros.map((m: { name: string }) => m.name)).toContain("PRINT_START");
    expect(list.commands.map((c: { name: string }) => c.name)).toContain("G28");
  });
});

describe("printer administration", () => {
  async function connectedPrinter(options: Parameters<typeof fakePrinter>[0] = {}) {
    const fake = await fakePrinter(options);
    const { id } = (await api("POST", "/api/printers", { name: "Admin", url: fake.url })).json();
    await waitForState(id, options.printing ? "printing" : "idle");
    return { fake, id };
  }

  it("lets only admins read and write config", async () => {
    const { id } = await connectedPrinter();
    expect(
      (await api("GET", `/api/printers/${id}/config/files`, undefined, operator)).statusCode,
    ).toBe(403);
    const files = (await api("GET", `/api/printers/${id}/config/files`)).json().files;
    expect(files.map((f: { path: string }) => f.path)).toContain("printer.cfg");
    const file = (await api("GET", `/api/printers/${id}/config/file?path=printer.cfg`)).json();
    expect(file.content).toContain("[printer]");
    expect(
      (await api("GET", `/api/printers/${id}/config/file?path=../etc/passwd`)).statusCode,
    ).toBe(400);
    expect((await api("GET", `/api/printers/${id}/config/file?path=missing.cfg`)).statusCode).toBe(
      404,
    );
  });

  it("backs up the previous version on save and detects conflicts", async () => {
    const { fake, id } = await connectedPrinter();
    const file = (await api("GET", `/api/printers/${id}/config/file?path=printer.cfg`)).json();
    const save = (content: string, extra: object = {}) =>
      api("PUT", `/api/printers/${id}/config/file`, {
        path: "printer.cfg",
        content,
        baseModified: file.modified,
        ...extra,
      });
    const saved = await save("[printer]\nmax_velocity: 400\n");
    expect(saved.statusCode).toBe(200);
    expect(fake.config["printer.cfg"]?.content).toBe("[printer]\nmax_velocity: 400\n");

    // The printer's copy is now newer than the version loaded above.
    fake.config["printer.cfg"] = { content: "edited elsewhere", modified: Date.now() / 1000 + 5 };
    const conflict = await save("mine");
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe("config_conflict");
    expect((await save("mine", { force: true, restart: true })).statusCode).toBe(200);
    expect(fake.actions).toEqual(["restart"]);

    const backups = (await api("GET", `/api/printers/${id}/config/backups?path=printer.cfg`)).json()
      .backups;
    expect(backups).toHaveLength(2);
    expect(backups[0].createdBy).toBe("Admin");
    const latest = (await api("GET", `/api/printers/${id}/config/backups/${backups[0].id}`)).json();
    expect(latest.content).toBe("edited elsewhere");
    const oldest = (await api("GET", `/api/printers/${id}/config/backups/${backups[1].id}`)).json();
    expect(oldest.content).toContain("[extruder]");

    const created = await api("PUT", `/api/printers/${id}/config/file`, {
      path: "new.cfg",
      content: "[gcode_macro HELLO]\ngcode:\n  M117 Hello\n",
      baseModified: null,
    });
    expect(created.statusCode).toBe(200);
    expect(
      (await api("GET", `/api/printers/${id}/config/backups?path=new.cfg`)).json().backups,
    ).toEqual([]);
  });

  it("restarts with role and print-state checks", async () => {
    const { fake, id } = await connectedPrinter();
    const restart = (body: object, cookie = admin) =>
      api("POST", `/api/printers/${id}/restart`, body, cookie);
    expect((await restart({ target: "firmware" }, operator)).statusCode).toBe(200);
    expect((await restart({ target: "service", service: "klipper" }, operator)).statusCode).toBe(
      403,
    );
    expect((await restart({ target: "service", service: "nope" })).statusCode).toBe(400);
    expect((await restart({ target: "service", service: "crowsnest" })).statusCode).toBe(200);
    expect((await restart({ target: "host", action: "shutdown" })).statusCode).toBe(200);
    expect((await restart({ target: "host", action: "format" })).statusCode).toBe(400);
    expect(fake.actions).toEqual(["firmware_restart", "service:crowsnest", "shutdown"]);
    const services = (await api("GET", `/api/printers/${id}/services`)).json().services;
    expect(services.map((s: { name: string }) => s.name)).toEqual([
      "klipper",
      "moonraker",
      "crowsnest",
    ]);
  });

  it("serves system information and logs to admins", async () => {
    const { id } = await connectedPrinter();
    expect((await api("GET", `/api/printers/${id}/system`, undefined, operator)).statusCode).toBe(
      403,
    );
    const system = (await api("GET", `/api/printers/${id}/system`)).json();
    expect(system.info.cpuCores).toBe(4);
    expect(system.stats.cpuUsage).toBe(12.5);

    const logs = (await api("GET", `/api/printers/${id}/logs`)).json().logs;
    expect(logs.map((l: { name: string }) => l.name)).toContain("klippy.log");
    const tailed = (await api("GET", `/api/printers/${id}/logs/file?name=klippy.log`)).json();
    // klippy.log is larger than the tail: only whole lines from the end are returned.
    expect(tailed.truncated).toBe(true);
    expect(tailed.content.startsWith("Stats ")).toBe(true);
    expect(tailed.content.endsWith("Timer too close\n")).toBe(true);
    const download = await api("GET", `/api/printers/${id}/logs/file?name=klippy.log&download=1`);
    expect(download.headers["content-disposition"]).toBe('attachment; filename="klippy.log"');
    expect(download.body.startsWith("Starting Klippy")).toBe(true);
    expect(download.body.endsWith(tailed.content)).toBe(true);
    const small = (await api("GET", `/api/printers/${id}/logs/file?name=moonraker.log`)).json();
    expect(small.truncated).toBe(false);
    expect(small.content).toContain("Starting Moonraker");
    expect((await api("GET", `/api/printers/${id}/logs/file?name=nope.log`)).statusCode).toBe(404);
    expect((await api("GET", `/api/printers/${id}/logs/file?name=../x`)).statusCode).toBe(400);
  });

  it("lets operators switch power devices, except locked ones while printing", async () => {
    const { fake, id } = await connectedPrinter({
      printing: { fileName: "cube.gcode", progress: 0.3 },
    });
    const devices = (await api("GET", `/api/printers/${id}/power`, undefined, operator)).json()
      .devices;
    expect(devices.map((d: { name: string }) => d.name)).toEqual(["printer", "lights"]);
    const set = (device: string, on: boolean) =>
      api("POST", `/api/printers/${id}/power`, { device, on }, operator);
    expect((await set("lights", true)).statusCode).toBe(200);
    expect(fake.power.lights?.status).toBe("on");
    expect((await set("printer", false)).statusCode).toBe(409);
    expect(fake.power.printer?.status).toBe("on");
    expect((await set("toaster", true)).statusCode).toBe(404);
  });

  it("refuses restarts while printing", async () => {
    const { id } = await connectedPrinter({ printing: { fileName: "cube.gcode", progress: 0.3 } });
    const res = await api("POST", `/api/printers/${id}/restart`, { target: "klipper" });
    expect(res.statusCode).toBe(409);
    const save = await api("PUT", `/api/printers/${id}/config/file`, {
      path: "printer.cfg",
      content: "x",
      baseModified: null,
      force: true,
      restart: true,
    });
    expect(save.statusCode).toBe(409);
  });
});

describe("groups", () => {
  it("creates groups, assigns printers and clears assignments on delete", async () => {
    const group = (await api("POST", "/api/printer-groups", { name: "Workshop" })).json();
    expect((await api("POST", "/api/printer-groups", { name: "workshop" })).statusCode).toBe(409);
    const printer = (
      await api("POST", "/api/printers", {
        name: "P",
        url: "http://127.0.0.1:1",
        groupId: group.id,
      })
    ).json();
    expect(printer.groupId).toBe(group.id);
    await api("DELETE", `/api/printer-groups/${group.id}`);
    expect((await listPrinters())[0]?.groupId).toBeNull();
  });
});

describe("realtime", () => {
  it("requires a session and pushes status snapshots and updates", async () => {
    await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    const port = (ctx.app.server.address() as AddressInfo).port;
    const url = `ws://127.0.0.1:${port}/api/ws`;

    const anonymous = new WebSocket(url);
    const rejected = await new Promise<number>((resolve) =>
      anonymous.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0)),
    );
    expect(rejected).toBe(401);

    const fake = await fakePrinter();
    const { id } = (await api("POST", "/api/printers", { name: "Live", url: fake.url })).json();
    await waitForState(id, "idle");

    const socket = new WebSocket(url, { headers: { cookie: operator } });
    const messages: RealtimeMessage[] = [];
    socket.on("message", (data) => messages.push(JSON.parse(String(data))));
    await new Promise((resolve) => socket.on("open", resolve));
    await new Promise((r) => setTimeout(r, 50));
    expect(messages).toContainEqual(
      expect.objectContaining({ type: "printer.status", printerId: id }),
    );

    await api("POST", `/api/printers/${id}/commands`, { action: "gcode", script: "G28" });
    await api("PATCH", `/api/printers/${id}`, { name: "Live 2" });
    await new Promise((r) => setTimeout(r, 50));
    expect(messages).toContainEqual({ type: "printer.console", printerId: id, line: "ok" });
    expect(messages).toContainEqual({ type: "printers.changed" });
    socket.close();
  });
});
