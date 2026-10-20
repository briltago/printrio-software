import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { PrinterStatus } from "@printrio/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { FakeMoonraker } from "../dev/fake-moonraker.ts";
import {
  heaterParam,
  MoonrakerDriver,
  parseMacroParams,
  resolveWebcamUrl,
  sortHeaters,
  toPrinterStatus,
  toWebSocketUrl,
} from "../src/drivers/moonraker.ts";
import { tail } from "../src/routes/printer-system.ts";

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

describe("parseMacroParams", () => {
  it("finds dotted and bracketed params with defaults, once each", () => {
    const gcode = [
      "{% set bed = params.BED|default(60)|float %}",
      "{% set tool = params['extruder'] | default( 215 ) %}",
      '{% set name = params.NAME|default("PLA") %}',
      "{% if params.BED %}M190 S{params.BED}{% endif %}",
      "G4 P{params.SECONDS * 1000}",
    ].join("\n");
    expect(parseMacroParams(gcode)).toEqual([
      { name: "BED", defaultValue: "60" },
      { name: "EXTRUDER", defaultValue: "215" },
      { name: "NAME", defaultValue: "PLA" },
      { name: "SECONDS", defaultValue: null },
    ]);
    expect(parseMacroParams("G28")).toEqual([]);
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

  it("lists G-code files with slicer metadata and thumbnails, per directory", async () => {
    const { url, driver } = await setup();
    await driver.connect({ url });
    const root = await driver.listFiles("");
    expect(root.directories).toEqual(["parts"]);
    expect(root.files.map((f) => f.path).sort()).toEqual([
      "3DBenchy.gcode",
      "enclosure_panel_left.gcode",
    ]);
    const benchy = root.files.find((f) => f.path === "3DBenchy.gcode");
    expect(benchy).toMatchObject({
      estimatedSeconds: 5820,
      filamentMm: 4210,
      filamentGrams: 12.6,
      slicer: "OrcaSlicer",
      thumbnailPath: ".thumbs/3DBenchy-300x300.png",
    });
    const parts = await driver.listFiles("parts");
    expect(parts.files[0]).toMatchObject({
      path: "parts/bracket_v3.gcode",
      thumbnailPath: "parts/.thumbs/bracket_v3-300x300.png",
    });
    const thumbnail = await driver.readFile("parts/.thumbs/bracket_v3-300x300.png");
    expect(thumbnail.contentType).toBe("image/png");
  });

  it("starts, deletes and uploads files into sub-directories", async () => {
    const { fake, url, driver } = await setup();
    await driver.connect({ url });
    await expect(driver.startPrint("missing.gcode")).rejects.toThrow(/does not exist/);
    const printing = nextStatus(driver, (s) => s.state === "printing");
    await driver.startPrint("3DBenchy.gcode");
    expect((await printing).job?.fileName).toBe("3DBenchy.gcode");
    await driver.deleteFile("parts/bracket_v3.gcode");
    expect((await driver.listFiles("parts")).files).toEqual([]);
    async function* data() {
      yield new TextEncoder().encode("G28\n");
    }
    await driver.uploadFile("parts/new.gcode", data());
    expect(fake.uploads).toEqual(["parts/new.gcode"]);
    expect((await driver.listFiles("parts")).files.map((f) => f.path)).toEqual(["parts/new.gcode"]);
  });

  it("reads the console backlog, including failed commands", async () => {
    const { url, driver } = await setup();
    await driver.connect({ url });
    await driver.sendGcode("M117 Hi");
    await expect(driver.sendGcode("NOPE")).rejects.toThrow('Unknown command:"NOPE"');
    const entries = await driver.getConsoleHistory(100);
    expect(entries.map(({ kind, message }) => [kind, message])).toEqual([
      ["command", "M117 Hi"],
      ["response", "ok"],
      ["command", "NOPE"],
      ["response", '!! Unknown command:"NOPE"'],
    ]);
    expect(entries[0]?.time).toBeInstanceOf(Date);
    expect(await driver.getConsoleHistory(1)).toHaveLength(1);
  });

  it("lists macros with descriptions and parameters, and G-code commands", async () => {
    const { url, driver } = await setup();
    await driver.connect({ url });
    const macros = await driver.listMacros();
    expect(macros.map((m) => m.name)).toEqual([
      "_HEAT_SOAK",
      "LOAD_FILAMENT",
      "PRINT_END",
      "PRINT_START",
    ]);
    expect(macros.find((m) => m.name === "PRINT_START")).toEqual({
      name: "PRINT_START",
      description: "Heat up, home and purge",
      params: [
        { name: "BED", defaultValue: "60" },
        { name: "EXTRUDER", defaultValue: "215" },
      ],
    });
    expect(macros.find((m) => m.name === "PRINT_END")?.description).toBeNull();
    const commands = await driver.listGcodeCommands();
    expect(commands).toContainEqual({ name: "G28", description: "Move to origin" });
    expect(commands.map((c) => c.name)).toContain("PRINT_START");
  });

  it("lists, reads and writes config files", async () => {
    const { fake, url, driver } = await setup();
    await driver.connect({ url });
    const files = await driver.listConfigFiles();
    expect(files.map((f) => f.path)).toEqual([
      "macros.cfg",
      "mainsail.cfg",
      "moonraker.conf",
      "printer.cfg",
    ]);
    expect(files[0]?.modified).toBeInstanceOf(Date);
    expect(await driver.readConfigFile("printer.cfg")).toContain("[printer]");
    const content = "[printer]\nkinematics: corexy\n# żluťoučký kůň\n";
    await driver.writeConfigFile("includes/extra.cfg", content);
    expect(fake.config["includes/extra.cfg"]?.content).toBe(content);
    expect(await driver.readConfigFile("includes/extra.cfg")).toBe(content);
  });

  it("restarts Klipper, the firmware and host services", async () => {
    const { fake, url, driver } = await setup();
    await driver.connect({ url });
    await driver.restartFirmware(false);
    await driver.restartFirmware(true);
    expect(await driver.listServices()).toContainEqual({ name: "crowsnest", state: "failed" });
    await driver.restartService("crowsnest");
    await driver.hostPower("reboot");
    expect(fake.actions).toEqual(["restart", "firmware_restart", "service:crowsnest", "reboot"]);
    const ready = await nextStatus(driver, (s) => s.state === "idle");
    expect(ready.state).toBe("idle");
  });

  it("lists and reads logs, using a range for the end of the file", async () => {
    const { url, driver } = await setup();
    await driver.connect({ url });
    const logs = await driver.listLogs();
    expect(logs.map((l) => l.name)).toEqual(["klippy.log", "moonraker.log", "crowsnest.log"]);
    const read = async (fromEnd?: number) => {
      const { partial, body } = await driver.readLog("klippy.log", fromEnd);
      const chunks: Uint8Array[] = [];
      for await (const chunk of body) chunks.push(chunk);
      return { partial, text: Buffer.concat(chunks).toString() };
    };
    const end = await read(64);
    expect(end.partial).toBe(true);
    expect(end.text).toHaveLength(64);
    expect(end.text.endsWith("Timer too close\n")).toBe(true);
    const { partial: smallPartial } = await driver.readLog("moonraker.log", 64 * 1024);
    expect(smallPartial).toBe(false);
    const full = await read();
    expect(full.partial).toBe(false);
    expect(full.text.startsWith("Starting Klippy")).toBe(true);
  });

  it("reports host information and live stats", async () => {
    const { url, driver } = await setup({ hostname: "trident" });
    await driver.connect({ url });
    expect(await driver.getSystemInfo()).toEqual({
      hostname: "trident",
      os: "Debian GNU/Linux 12 (bookworm)",
      kernel: "6.6.51+rpt-rpi-v8",
      cpu: "Raspberry Pi 4 Model B Rev 1.4",
      cpuCores: 4,
      memoryTotal: 3884520 * 1024,
      python: "3.11.2",
      firmwareVersion: "v0.12.0-385-g3fd2a3e5",
      hostSoftwareVersion: "fake",
      network: [{ name: "wlan0", addresses: ["192.168.1.42"] }],
    });
    expect(await driver.getSystemStats()).toEqual({
      cpuUsage: 12.5,
      cpuTemp: 48.3,
      memoryUsed: 884520 * 1024,
      memoryTotal: 3884520 * 1024,
      uptimeSeconds: 93_784.5,
    });
  });

  it("switches power devices and copes with hosts without any", async () => {
    const { fake, url, driver } = await setup();
    await driver.connect({ url });
    expect(await driver.listPowerDevices()).toEqual([
      { name: "printer", state: "on", type: "gpio", lockedWhilePrinting: true },
      { name: "lights", state: "off", type: "gpio", lockedWhilePrinting: false },
    ]);
    await driver.setPowerDevice("lights", true);
    expect(fake.power.lights?.status).toBe("on");

    const bare = await setup({ power: false });
    await bare.driver.connect({ url: bare.url });
    expect(await bare.driver.listPowerDevices()).toEqual([]);
  });

  it("reads print history and totals", async () => {
    const { url, driver } = await setup();
    await driver.connect({ url });
    const { jobs, totals } = await driver.listJobs(10, 0);
    expect(jobs.map((j) => j.status)).toEqual(["error", "cancelled", "completed"]);
    expect(jobs[0]).toMatchObject({
      fileName: "parts/bracket_v3.gcode",
      printSeconds: 260,
      filamentMm: 180,
    });
    expect(totals).toEqual({ jobs: 3, printSeconds: 7950, filamentMm: 5695 });
    expect((await driver.listJobs(1, 1)).jobs.map((j) => j.id)).toEqual(["000002"]);
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

describe("log tail", () => {
  it("keeps only the last bytes of a stream", async () => {
    async function* chunks() {
      yield Buffer.from("aaaa");
      yield Buffer.from("bbbb");
      yield Buffer.from("cc");
    }
    const { bytes, dropped } = await tail(chunks(), 5);
    expect(bytes.toString()).toBe("bbbcc");
    expect(dropped).toBe(true);
    expect((await tail(chunks(), 50)).dropped).toBe(false);
  });
});
