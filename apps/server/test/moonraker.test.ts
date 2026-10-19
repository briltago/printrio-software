import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { PrinterStatus } from "@printrio/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { FakeMoonraker } from "../dev/fake-moonraker.ts";
import {
  MoonrakerDriver,
  sortHeaters,
  toPrinterStatus,
  toWebSocketUrl,
} from "../src/drivers/moonraker.ts";

const fakes: FakeMoonraker[] = [];
const drivers: MoonrakerDriver[] = [];
afterEach(async () => {
  await Promise.all(drivers.splice(0).map((d) => d.disconnect()));
  await Promise.all(fakes.splice(0).map((f) => f.stop()));
});

async function setup(options: ConstructorParameters<typeof FakeMoonraker>[0] = {}) {
  const fake = new FakeMoonraker({ tickMs: 0, ...options });
  fakes.push(fake);
  const url = await fake.start();
  const driver = new MoonrakerDriver();
  drivers.push(driver);
  return { fake, url, driver };
}

function nextStatus(driver: MoonrakerDriver, predicate: (s: PrinterStatus) => boolean) {
  return new Promise<PrinterStatus>((resolve) => {
    const off = driver.onStatus((status) => {
      if (predicate(status)) {
        off();
        resolve(status);
      }
    });
  });
}

describe("toWebSocketUrl", () => {
  it("maps http(s) base URLs to the websocket endpoint", () => {
    expect(toWebSocketUrl("http://voron.local:7125")).toBe("ws://voron.local:7125/websocket");
    expect(toWebSocketUrl("https://farm.example/printer1/")).toBe(
      "wss://farm.example/printer1/websocket",
    );
  });
});

describe("sortHeaters", () => {
  it("lists nozzles, bed, other heaters, then sensors", () => {
    expect(
      sortHeaters([
        "temperature_sensor mcu_temp",
        "heater_bed",
        "extruder1",
        "heater_generic chamber",
        "extruder",
      ]),
    ).toEqual([
      "extruder",
      "extruder1",
      "heater_bed",
      "heater_generic chamber",
      "temperature_sensor mcu_temp",
    ]);
  });
});

describe("toPrinterStatus", () => {
  it("reports Klipper shutdown as an error with its message", () => {
    const status = toPrinterStatus(
      { webhooks: { state: "shutdown", state_message: "MCU timeout" } },
      [],
    );
    expect(status.state).toBe("error");
    expect(status.message).toBe("MCU timeout");
  });

  it("estimates remaining time from progress", () => {
    const status = toPrinterStatus(
      {
        webhooks: { state: "ready" },
        print_stats: { state: "printing", filename: "benchy.gcode", print_duration: 600 },
        virtual_sdcard: { progress: 0.25 },
        extruder: { temperature: 215, target: 215 },
      },
      ["extruder"],
    );
    expect(status.job).toMatchObject({
      fileName: "benchy.gcode",
      progress: 0.25,
      remainingSeconds: 1800,
    });
    expect(status.temperatures).toEqual([{ name: "extruder", current: 215, target: 215 }]);
  });
});

describe("MoonrakerDriver", () => {
  it("connects, reads printer info and an idle status with heaters", async () => {
    const { url, driver } = await setup({ hostname: "voron-24" });
    await driver.connect({ url });
    expect(await driver.getInfo()).toEqual({ hostname: "voron-24", firmwareState: "ready" });
    const status = await driver.getStatus();
    expect(status.state).toBe("idle");
    expect(status.temperatures.map((t) => t.name)).toEqual(["extruder", "heater_bed"]);
  });

  it("rejects a wrong or missing API key with a clear message", async () => {
    const { url, driver } = await setup({ apiKey: "secret" });
    await expect(driver.connect({ url, apiKey: "wrong" })).rejects.toThrow(/rejected the API key/);
    await expect(new MoonrakerDriver().connect({ url })).rejects.toThrow(/requires authentication/);
  });

  it("accepts the right API key", async () => {
    const { url, driver } = await setup({ apiKey: "secret" });
    await driver.connect({ url, apiKey: "secret" });
    expect((await driver.getStatus()).state).toBe("idle");
  });

  it("explains https:// pointed at Moonraker's plain HTTP port", async () => {
    const { url } = await setup();
    const https = url.replace("http://", "https://");
    await expect(new MoonrakerDriver().connect({ url: https })).rejects.toThrow(
      /Use http:\/\/ instead of https:\/\//,
    );
  });

  it("explains a port where nothing listens", async () => {
    const server = createServer().listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;
    await new Promise((resolve) => server.close(resolve));
    await expect(
      new MoonrakerDriver().connect({ url: `http://127.0.0.1:${port}` }),
    ).rejects.toThrow(/Nothing is listening/);
  });

  it("explains a web server that isn't Moonraker", async () => {
    const server = createServer((_req, res) =>
      res.writeHead(404).end("<html>Fluidd</html>"),
    ).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;
    await expect(
      new MoonrakerDriver().connect({ url: `http://127.0.0.1:${port}` }),
    ).rejects.toThrow(/isn't Moonraker/);
    server.close();
  });

  it("streams live progress and controls a print", async () => {
    const { fake, url, driver } = await setup({
      printing: { fileName: "benchy.gcode", progress: 0.4 },
    });
    await driver.connect({ url });
    expect((await driver.getStatus()).job?.fileName).toBe("benchy.gcode");

    const advanced = nextStatus(driver, (s) => (s.job?.progress ?? 0) > 0.4);
    fake.tick();
    expect((await advanced).state).toBe("printing");

    const paused = nextStatus(driver, (s) => s.state === "paused");
    await driver.pause();
    await paused;
    const printing = nextStatus(driver, (s) => s.state === "printing");
    await driver.resume();
    await printing;
    const idle = nextStatus(driver, (s) => s.state === "idle");
    await driver.cancel();
    expect((await idle).job).toBeNull();
  });

  it("forwards G-code and console output", async () => {
    const { fake, url, driver } = await setup();
    await driver.connect({ url });
    const lines: string[] = [];
    driver.onConsole((line) => lines.push(line));
    await driver.sendGcode("G28");
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.gcode).toEqual(["G28"]);
    expect(lines).toContain("ok");
  });

  it("follows Klipper shutdown and restart", async () => {
    const { fake, url, driver } = await setup();
    await driver.connect({ url });
    const error = nextStatus(driver, (s) => s.state === "error");
    fake.setKlippyState("shutdown");
    expect((await error).message).toBe("Klipper shutdown");
    const ready = nextStatus(driver, (s) => s.state === "idle");
    fake.setKlippyState("ready");
    await ready;
  });

  it("reports offline and fires onDisconnect when the host goes away", async () => {
    const { fake, url, driver } = await setup();
    await driver.connect({ url });
    const disconnected = new Promise<void>((resolve) => driver.onDisconnect(resolve));
    fake.dropConnections();
    await disconnected;
    expect((await driver.getStatus()).state).toBe("offline");
  });

  it("uploads files through the HTTP API", async () => {
    const { fake, url, driver } = await setup();
    await driver.connect({ url });
    async function* data() {
      yield new TextEncoder().encode("G28\n");
    }
    await driver.uploadFile("cube.gcode", data());
    expect(fake.uploads).toEqual(["cube.gcode"]);
  });
});
