import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { PrinterStatus } from "@printrio/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { FakeMoonraker } from "../dev/fake-moonraker.ts";
import {
  heaterParam,
  MoonrakerDriver,
  resolveWebcamUrl,
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

describe("webcam and heater helpers", () => {
  it("resolves relative webcam URLs against the printer's web server, not Moonraker's port", () => {
    expect(resolveWebcamUrl("http://10.0.0.201:7125", "/webcam/?action=stream")).toBe(
      "http://10.0.0.201/webcam/?action=stream",
    );
    expect(
      resolveWebcamUrl("http://10.0.0.201:7125", "http://10.0.0.201:8080/?action=stream"),
    ).toBe("http://10.0.0.201:8080/?action=stream");
    expect(resolveWebcamUrl("http://10.0.0.201:7125", "")).toBeNull();
  });

  it("uses the short name for heater_generic objects", () => {
    expect(heaterParam("heater_generic chamber")).toBe("chamber");
    expect(heaterParam("extruder")).toBe("extruder");
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
    expect(status.temperatures).toEqual([
      {
        id: "extruder",
        name: "extruder",
        current: 215,
        target: 215,
        controllable: true,
        power: null,
      },
    ]);
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

  it("marks heaters controllable and sensors not", async () => {
    const status = toPrinterStatus(
      {
        webhooks: { state: "ready" },
        extruder: { temperature: 200, target: 210 },
        "temperature_sensor mcu_temp": { temperature: 38 },
      },
      ["extruder", "temperature_sensor mcu_temp"],
    );
    expect(status.temperatures).toEqual([
      {
        id: "extruder",
        name: "extruder",
        current: 200,
        target: 210,
        controllable: true,
        power: null,
      },
      {
        id: "temperature_sensor mcu_temp",
        name: "mcu_temp",
        current: 38,
        target: null,
        controllable: false,
        power: null,
      },
    ]);
  });

  it("sets heater targets and rejects non-heaters", async () => {
    const { fake, url, driver } = await setup();
    await driver.connect({ url });
    const heated = nextStatus(
      driver,
      (s) => s.temperatures.find((t) => t.id === "heater_bed")?.target === 60,
    );
    await driver.setTemperature("heater_bed", 60);
    await heated;
    expect(fake.gcode).toEqual(["SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=60"]);
    await expect(driver.setTemperature("temperature_sensor mcu_temp", 50)).rejects.toThrow(
      /not a heater/,
    );
  });

  it("reads temperature history and webcams", async () => {
    const { url, driver } = await setup({ printing: { fileName: "x.gcode", progress: 0.5 } });
    await driver.connect({ url });
    const history = await driver.getTemperatureHistory();
    expect(history.series.map((s) => s.id)).toEqual(["extruder", "heater_bed"]);
    expect(history.series[0]?.temperatures.length).toBe(600);
    expect(history.series[0]?.targets?.at(-1)).toBe(215);
    const [cam] = await driver.listWebcams();
    expect(cam).toMatchObject({
      name: "Nozzle cam",
      service: "mjpegstreamer",
      streamUrl: `${url}/webcam/?action=stream`,
    });
  });

  it("reports motion status and runs motion commands as Klipper G-code", async () => {
    const { fake, url, driver } = await setup();
    await driver.connect({ url });
    expect((await driver.getStatus()).motion).toMatchObject({
      homedAxes: [],
      zOffset: 0,
      speedFactor: 1,
    });

    await expect(driver.jog("x", 10)).rejects.toThrow(/Must home axis first/);
    const homed = nextStatus(driver, (s) => s.motion?.homedAxes.length === 3);
    await driver.home([]);
    await homed;
    const moved = nextStatus(driver, (s) => s.motion?.position.x === 10);
    await driver.jog("x", 10);
    await moved;
    await driver.home(["x", "y"]);
    await driver.adjustZOffset(-0.025);
    await driver.setSpeedFactor(1.25);
    await driver.setFlowFactor(0.95);
    await driver.motorsOff();
    expect(fake.gcode).toEqual([
      "G28",
      "G91\nG1 X10 F6000\nG90",
      "G28 X Y",
      "SET_GCODE_OFFSET Z_ADJUST=-0.025 MOVE=1",
      "M220 S125",
      "M221 S95",
      "M84",
    ]);
    const status = await driver.getStatus();
    expect(status.motion).toMatchObject({
      homedAxes: [],
      zOffset: -0.025,
      speedFactor: 1.25,
      flowFactor: 0.95,
    });
  });

  it("controls the standard part fan and lists automatic fans read-only", async () => {
    const { fake, url, driver } = await setup();
    await driver.connect({ url });
    expect((await driver.getStatus()).fans).toEqual([
      { id: "fan", name: "fan", speed: 0, controllable: true },
      { id: "heater_fan hotend_fan", name: "hotend_fan", speed: 0, controllable: false },
    ]);
    const spinning = nextStatus(
      driver,
      (s) => s.fans.find((f) => f.id === "fan")?.speed === 128 / 255,
    );
    await driver.setFanSpeed("fan", 0.5);
    await spinning;
    await driver.setFanSpeed("fan", 0);
    await expect(driver.setFanSpeed("heater_fan hotend_fan", 1)).rejects.toThrow(
      /not a controllable fan/,
    );
    expect(fake.gcode).toEqual(["M106 S128", "M107"]);
  });

  it("drives Creality's output_pin part fan with SET_PIN in the configured scale", async () => {
    const { fake, url, driver } = await setup({ creality: true });
    await driver.connect({ url });
    expect((await driver.getStatus()).fans.map((f) => f.id)).toEqual([
      "output_pin fan0",
      "heater_fan hotend_fan",
    ]);
    const spinning = nextStatus(driver, (s) => Math.abs((s.fans[0]?.speed ?? 0) - 0.53) < 0.001);
    await driver.setFanSpeed("output_pin fan0", 0.53);
    await spinning;
    expect(fake.gcode).toEqual(["SET_PIN PIN=fan0 VALUE=135.15"]);
  });

  it("lists printable objects during a print and excludes them", async () => {
    const { fake, url, driver } = await setup({
      printing: { fileName: "plate.gcode", progress: 0.3 },
    });
    await driver.connect({ url });
    expect((await driver.getStatus()).exclusion).toEqual({
      objects: ["PART_1", "PART_2", "PART_3"],
      excluded: [],
      current: "PART_2",
    });
    const excluded = nextStatus(driver, (s) => s.exclusion?.excluded.includes("PART_3") ?? false);
    await driver.excludeObject("PART_3");
    await excluded;
    expect(fake.gcode).toEqual(["EXCLUDE_OBJECT NAME=PART_3"]);
    await expect(driver.excludeObject("PART_1;M112")).rejects.toThrow(/Invalid object name/);
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
