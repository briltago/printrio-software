import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { type WebSocket, WebSocketServer } from "ws";

/**
 * A small Moonraker simulator for tests and UI development. Implements the
 * JSON-RPC methods the Moonraker driver uses and simulates a print (progress,
 * heaters, filament) on a timer. Not part of the production bundle.
 */

export interface FakeMoonrakerOptions {
  port?: number;
  hostname?: string;
  /** When set, clients must identify with this API key. */
  apiKey?: string;
  /** Start in the middle of a print. */
  printing?: { fileName: string; progress: number };
  /** Simulation tick; 0 disables the timer (tests drive state explicitly). */
  tickMs?: number;
  /** Creality-style fans: part fan as `output_pin fan0` (scale 255) instead of `[fan]`. */
  creality?: boolean;
  /** Progress added per tick while printing. */
  progressPerTick?: number;
}

type Objects = Record<string, Record<string, unknown>>;

const WEBCAM_FRAME = readFileSync(new URL("./fake-webcam.jpg", import.meta.url));
const THUMBNAIL = readFileSync(new URL("./fake-thumbnail.png", import.meta.url));

interface FakeFile {
  size: number;
  modified: number;
  estimated_time: number;
  filament_total: number;
  filament_weight_total: number;
}
interface FakeJob {
  job_id: string;
  filename: string;
  status: string;
  start_time: number;
  end_time: number | null;
  print_duration: number;
  filament_used: number;
}

const now = () => Date.now() / 1000;
const SAMPLE_FILES: Record<string, FakeFile> = {
  "3DBenchy.gcode": {
    size: 2_480_133,
    modified: now() - 86_400 * 3,
    estimated_time: 5_820,
    filament_total: 4_210,
    filament_weight_total: 12.6,
  },
  "enclosure_panel_left.gcode": {
    size: 9_812_442,
    modified: now() - 86_400,
    estimated_time: 14_400,
    filament_total: 22_950,
    filament_weight_total: 68.9,
  },
  "parts/bracket_v3.gcode": {
    size: 812_002,
    modified: now() - 3_600,
    estimated_time: 2_310,
    filament_total: 1_640,
    filament_weight_total: 4.9,
  },
};
const HISTORY_SIZE = 1200;
const HEATERS = ["extruder", "heater_bed"] as const;

/** Commands the fake firmware understands (subset of Klipper's `printer.gcode.help`). */
const GCODE_HELP: Record<string, string> = {
  G1: "Linear move",
  G28: "Move to origin",
  G90: "Absolute positioning",
  G91: "Relative positioning",
  M84: "Disable steppers",
  M105: "Report temperatures",
  M106: "Set fan speed",
  M107: "Turn fan off",
  M117: "Display message",
  M220: "Set speed factor",
  M221: "Set extrude factor",
  EXCLUDE_OBJECT: "Cancel moves for an object",
  SET_FAN_SPEED: "Set the speed of a generic fan",
  SET_GCODE_OFFSET: "Set a virtual offset to g-code positions",
  SET_HEATER_TEMPERATURE: "Sets a heater temperature",
  SET_PIN: "Set the value of an output pin",
  STATUS: "Report the printer status",
};

/** Macro sections as Moonraker reports them in `configfile.config` (lower-case keys). */
const MACROS: Record<string, { name: string; description?: string; gcode: string }> = {
  "gcode_macro print_start": {
    name: "PRINT_START",
    description: "Heat up, home and purge",
    gcode:
      "{% set bed = params.BED|default(60)|float %}\n{% set extruder = params['EXTRUDER']|default(215)|float %}\nM190 S{bed}\nM109 S{extruder}\nG28",
  },
  "gcode_macro print_end": { name: "PRINT_END", gcode: "M104 S0\nM140 S0\nM84" },
  "gcode_macro load_filament": {
    name: "LOAD_FILAMENT",
    description: "Load filament into the hotend",
    gcode: "{% set length = params.LENGTH|default(50) %}\nG1 E{length} F300",
  },
  "gcode_macro _heat_soak": { name: "_HEAT_SOAK", gcode: "G4 P{params.SECONDS * 1000}" },
};

export class FakeMoonraker {
  readonly gcode: string[] = [];
  private gcodeStore: { message: string; time: number; type: "command" | "response" }[] = [];
  readonly uploads: string[] = [];
  readonly files: Record<string, FakeFile> = structuredClone(SAMPLE_FILES);
  readonly jobs: FakeJob[] = [
    {
      job_id: "000003",
      filename: "parts/bracket_v3.gcode",
      status: "error",
      start_time: now() - 7_200,
      end_time: now() - 6_900,
      print_duration: 260,
      filament_used: 180,
    },
    {
      job_id: "000002",
      filename: "3DBenchy.gcode",
      status: "cancelled",
      start_time: now() - 90_000,
      end_time: now() - 88_000,
      print_duration: 1_900,
      filament_used: 1_310,
    },
    {
      job_id: "000001",
      filename: "3DBenchy.gcode",
      status: "completed",
      start_time: now() - 200_000,
      end_time: now() - 194_000,
      print_duration: 5_790,
      filament_used: 4_205,
    },
  ];
  private server: Server;
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private objects: Objects;
  /** Moonraker's temperature_store: one sample per tick, newest last. */
  private history: Record<string, { temperatures: number[]; targets: number[] }> = {};

  constructor(private options: FakeMoonrakerOptions = {}) {
    this.objects = {
      webhooks: { state: "ready", state_message: "Printer is ready" },
      print_stats: {
        state: "standby",
        filename: "",
        print_duration: 0,
        filament_used: 0,
        message: "",
      },
      virtual_sdcard: { progress: 0 },
      display_status: { progress: 0, message: null },
      extruder: { temperature: 24.5, target: 0 },
      heater_bed: { temperature: 23.8, target: 0 },
      toolhead: { homed_axes: "", axis_minimum: [0, 0, -2, 0], axis_maximum: [250, 250, 230, 0] },
      gcode_move: {
        gcode_position: [0, 0, 0, 0],
        homing_origin: [0, 0, 0, 0],
        speed_factor: 1,
        extrude_factor: 1,
      },
      ...(options.creality ? { "output_pin fan0": { value: 0 } } : { fan: { speed: 0 } }),
      "heater_fan hotend_fan": { speed: 0 },
      ...Object.fromEntries(
        Object.values(MACROS).map((macro) => [`gcode_macro ${macro.name}`, {}]),
      ),
      exclude_object: { objects: [], excluded_objects: [], current_object: null },
    };
    if (options.printing) this.startPrint(options.printing.fileName, options.printing.progress);
    // Ten minutes of plausible history so charts have something to draw immediately.
    for (const name of HEATERS) {
      const target = Number(this.objects[name]?.target ?? 0);
      const temperatures = Array.from({ length: 600 }, (_, i) => {
        const settled =
          target > 0 ? Math.min(target, 24 + (target - 24) * Math.min(1, i / 180)) : 24;
        return Math.round((settled + Math.sin(i / 7) * 0.4) * 10) / 10;
      });
      this.history[name] = { temperatures, targets: temperatures.map(() => target) };
    }

    this.server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/webcam/?action=snapshot") {
        res
          .writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": WEBCAM_FRAME.length })
          .end(WEBCAM_FRAME);
        return;
      }
      if (req.method === "GET" && req.url === "/webcam/?action=stream") {
        const boundary = "frame";
        res.writeHead(200, { "Content-Type": `multipart/x-mixed-replace; boundary=${boundary}` });
        const send = () =>
          res.write(
            `--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${WEBCAM_FRAME.length}\r\n\r\n`,
          ) && res.write(Buffer.concat([WEBCAM_FRAME, Buffer.from("\r\n")]));
        send();
        const timer = setInterval(send, 500);
        req.on("close", () => clearInterval(timer));
        return;
      }
      if (req.method === "GET" && req.url?.startsWith("/server/files/gcodes/")) {
        const path = decodeURIComponent(req.url.slice("/server/files/gcodes/".length));
        if (/(^|\/)\.thumbs\/[^/]+\.png$/.test(path)) {
          res
            .writeHead(200, { "Content-Type": "image/png", "Content-Length": THUMBNAIL.length })
            .end(THUMBNAIL);
          return;
        }
        res.writeHead(404).end();
        return;
      }
      if (req.method === "GET" && req.url === "/server/info") {
        if (options.apiKey && req.headers["x-api-key"] !== options.apiKey) {
          res
            .writeHead(401, { "Content-Type": "application/json" })
            .end(JSON.stringify({ error: { code: 401, message: "Unauthorized" } }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            result: { klippy_state: this.objects.webhooks?.state, moonraker_version: "fake" },
          }),
        );
        return;
      }
      if (req.method === "POST" && req.url?.startsWith("/server/files/upload")) {
        if (options.apiKey && req.headers["x-api-key"] !== options.apiKey) {
          res.writeHead(401).end();
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          const name = /filename="([^"]+)"/.exec(body)?.[1] ?? "upload.gcode";
          const dir = /name="path"\r\n\r\n([^\r]*)/.exec(body)?.[1];
          const path = dir ? `${dir}/${name}` : name;
          this.uploads.push(path);
          this.files[path] = {
            size: body.length,
            modified: now(),
            estimated_time: 600,
            filament_total: 500,
            filament_weight_total: 1.5,
          };
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ result: { item: { path: name, root: "gcodes" } } }));
        });
        return;
      }
      res.writeHead(404).end();
    });
    this.wss = new WebSocketServer({ server: this.server, path: "/websocket" });
    this.wss.on("connection", (socket) => this.handleClient(socket));
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve) =>
      this.server.listen(this.options.port ?? 0, "127.0.0.1", resolve),
    );
    const tickMs = this.options.tickMs ?? 1000;
    if (tickMs > 0) this.timer = setInterval(() => this.tick(), tickMs);
    return this.url;
  }

  get url() {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    for (const client of this.clients) client.terminate();
    this.wss.close();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Simulates Klipper going into shutdown, restarting, etc. */
  setKlippyState(state: "ready" | "shutdown" | "startup") {
    this.update({ webhooks: { state, state_message: `Klipper ${state}` } });
    if (state === "ready") this.notify("notify_klippy_ready", []);
    if (state === "shutdown") this.notify("notify_klippy_shutdown", []);
  }

  /** Drops all client connections (as if the printer host went away). */
  dropConnections() {
    for (const client of this.clients) client.terminate();
  }

  tick() {
    const stats = this.objects.print_stats ?? {};
    const extruder = this.objects.extruder ?? {};
    const bed = this.objects.heater_bed ?? {};
    const approach = (current: number, target: number) =>
      Math.round(
        (current + (Math.max(target, 22) - current) * 0.25 + (Math.random() - 0.5) * 0.4) * 10,
      ) / 10;
    // Duty cycle: high while far below target, settling around 30–40 % once there.
    const power = (current: number, target: number) =>
      target <= 0
        ? 0
        : Math.round(Math.min(1, Math.max(0.3, (target - current) / 20 + 0.35)) * 100) / 100;
    const update: Objects = {
      extruder: {
        temperature: approach(Number(extruder.temperature), Number(extruder.target)),
        power: power(Number(extruder.temperature), Number(extruder.target)),
      },
      heater_bed: {
        temperature: approach(Number(bed.temperature), Number(bed.target)),
        power: power(Number(bed.temperature), Number(bed.target)),
      },
      "heater_fan hotend_fan": { speed: Number(extruder.temperature) > 50 ? 1 : 0 },
    };
    for (const name of HEATERS) {
      const entry = this.history[name];
      if (!entry) continue;
      entry.temperatures = [...entry.temperatures, Number(update[name]?.temperature)].slice(
        -HISTORY_SIZE,
      );
      entry.targets = [...entry.targets, Number(this.objects[name]?.target ?? 0)].slice(
        -HISTORY_SIZE,
      );
    }
    if (stats.state === "printing") {
      const progress = Math.min(
        1,
        Number(this.objects.virtual_sdcard?.progress) + (this.options.progressPerTick ?? 0.002),
      );
      update.virtual_sdcard = { progress };
      update.display_status = { progress };
      update.print_stats = {
        print_duration: Number(stats.print_duration) + (this.options.tickMs ?? 1000) / 1000,
        filament_used: Number(stats.filament_used) + 12.5,
      };
      if (progress >= 1) {
        update.print_stats = { ...update.print_stats, state: "complete" };
        if (this.jobs[0]?.status === "in_progress")
          Object.assign(this.jobs[0], { status: "completed", end_time: now() });
        update.extruder = { ...update.extruder, target: 0 };
        update.heater_bed = { ...update.heater_bed, target: 0 };
      }
    }
    this.update(update);
  }

  /** Applies the G-code the driver sends; returns a Klipper-style error message on failure. */
  private runGcode(script: string): string | null {
    let relative = false;
    const move = { ...this.objects.gcode_move } as Record<string, unknown>;
    const toolhead = { ...this.objects.toolhead } as Record<string, unknown>;
    const position = [...(move.gcode_position as number[])];
    const origin = [...(move.homing_origin as number[])];
    const axes = ["X", "Y", "Z"];
    for (const line of script.split("\n").map((l) => l.trim())) {
      const [command = "", ...args] = line.split(/\s+/);
      const arg = (key: string) =>
        args.find((a) => a.toUpperCase().startsWith(key))?.slice(key.length);
      switch (command.toUpperCase()) {
        case "SET_HEATER_TEMPERATURE": {
          const heater = arg("HEATER=");
          if (heater && this.objects[heater])
            this.update({ [heater]: { target: Number(arg("TARGET=")) } });
          break;
        }
        case "G28": {
          const homing = args.length ? args.map((a) => a.toLowerCase()) : ["x", "y", "z"];
          toolhead.homed_axes = [...new Set([...String(toolhead.homed_axes), ...homing])]
            .sort()
            .join("");
          for (const axis of homing) position[axes.indexOf(axis.toUpperCase())] = 0;
          break;
        }
        case "G91":
          relative = true;
          break;
        case "G90":
          relative = false;
          break;
        case "G1":
          for (const [i, axis] of axes.entries()) {
            const value = arg(axis);
            if (value === undefined) continue;
            if (!String(toolhead.homed_axes).includes(axis.toLowerCase())) {
              return "Must home axis first: 0.000 0.000 0.000 [0.000]";
            }
            position[i] = relative ? Number(position[i]) + Number(value) : Number(value);
          }
          break;
        case "M84":
          toolhead.homed_axes = "";
          break;
        case "SET_GCODE_OFFSET":
          origin[2] = Math.round((Number(origin[2]) + Number(arg("Z_ADJUST=") ?? 0)) * 1000) / 1000;
          break;
        case "M220":
          move.speed_factor = Number(arg("S")) / 100;
          break;
        case "M221":
          move.extrude_factor = Number(arg("S")) / 100;
          break;
        case "M106":
          this.update({ fan: { speed: Number(arg("S")) / 255 } });
          break;
        case "M107":
          this.update({ fan: { speed: 0 } });
          break;
        case "SET_FAN_SPEED":
          this.update({ [`fan_generic ${arg("FAN=")}`]: { speed: Number(arg("SPEED=")) } });
          break;
        case "SET_PIN": {
          const pin = `output_pin ${arg("PIN=")}`;
          if (!this.objects[pin]) return `Unknown pin ${arg("PIN=")}`;
          // Klipper reports output_pin value normalised by the configured scale.
          this.update({ [pin]: { value: Number(arg("VALUE=")) / 255 } });
          break;
        }
        case "EXCLUDE_OBJECT": {
          const exclusion = this.objects.exclude_object ?? {};
          const excluded = [
            ...((exclusion.excluded_objects as string[]) ?? []),
            String(arg("NAME=")),
          ];
          this.update({ exclude_object: { excluded_objects: excluded } });
          break;
        }
        default: {
          const name = command.toUpperCase();
          const macro = Object.values(MACROS).find((m) => m.name === name);
          if (macro) this.respond(`// Running ${macro.name}`);
          else if (!GCODE_HELP[name]) return `Unknown command:"${name}"`;
        }
      }
    }
    this.update({
      toolhead,
      gcode_move: { ...move, gcode_position: position, homing_origin: origin },
    });
    return null;
  }

  private startPrint(fileName: string, progress = 0): Objects {
    const objects: Objects = {
      print_stats: {
        state: "printing",
        filename: fileName,
        print_duration: Math.round(progress * 7200),
        filament_used: Math.round(progress * 9000),
        message: "",
      },
      virtual_sdcard: { progress },
      display_status: { progress },
      extruder: { target: 215, temperature: progress > 0 ? 214.6 : 24.5 },
      heater_bed: { target: 60, temperature: progress > 0 ? 59.8 : 23.8 },
      toolhead: { ...this.objects.toolhead, homed_axes: "xyz" },
      gcode_move: { ...this.objects.gcode_move, gcode_position: [125.4, 98.2, 12.6, 0] },
      ...(this.options.creality ? { "output_pin fan0": { value: 1 } } : { fan: { speed: 1 } }),
      "heater_fan hotend_fan": { speed: 1 },
      exclude_object: {
        objects: [{ name: "PART_1" }, { name: "PART_2" }, { name: "PART_3" }],
        excluded_objects: [],
        current_object: "PART_2",
      },
    };
    for (const [name, fields] of Object.entries(objects))
      this.objects[name] = { ...this.objects[name], ...fields };
    return objects;
  }

  private update(changes: Objects) {
    for (const [name, fields] of Object.entries(changes))
      this.objects[name] = { ...this.objects[name], ...fields };
    this.notify("notify_status_update", [changes, Date.now() / 1000]);
  }

  /** A console line: broadcast like Klipper's gcode responses and kept in the gcode store. */
  private respond(line: string) {
    this.gcodeStore = [
      ...this.gcodeStore,
      { message: line, time: now(), type: "response" as const },
    ].slice(-1000);
    this.notify("notify_gcode_response", [line]);
  }

  private notify(method: string, params: unknown[]) {
    const message = JSON.stringify({ jsonrpc: "2.0", method, params });
    for (const client of this.clients) client.send(message);
  }

  private handleClient(socket: WebSocket) {
    let identified = !this.options.apiKey;
    this.clients.add(socket);
    socket.on("close", () => this.clients.delete(socket));
    socket.on("message", (raw) => {
      const { id, method, params = {} } = JSON.parse(String(raw));
      const reply = (result: unknown) =>
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
      const fail = (code: number, message: string) =>
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));

      if (method === "server.connection.identify") {
        if (this.options.apiKey && params.api_key !== this.options.apiKey)
          return fail(401, "Unauthorized");
        identified = true;
        return reply({ connection_id: 1 });
      }
      if (!identified) return fail(401, "Unauthorized");

      const klippyState = String(this.objects.webhooks?.state);
      switch (method) {
        case "server.info":
          return reply({
            klippy_connected: true,
            klippy_state: klippyState,
            moonraker_version: "fake",
          });
        case "printer.info":
          return reply({
            state: klippyState,
            state_message: this.objects.webhooks?.state_message,
            hostname: this.options.hostname ?? "fake-printer",
          });
        case "printer.objects.list":
          if (klippyState !== "ready") return fail(503, "Klippy not ready");
          return reply({ objects: Object.keys(this.objects) });
        case "printer.objects.query":
          return reply({
            eventtime: Date.now() / 1000,
            status: {
              configfile: {
                settings: { "output_pin fan0": { pwm: true, scale: 255 } },
                config: Object.fromEntries(
                  Object.entries(MACROS).map(([key, { description, gcode }]) => [
                    key,
                    { ...(description ? { description } : {}), gcode },
                  ]),
                ),
              },
            },
          });
        case "printer.gcode.help":
          return reply({
            ...GCODE_HELP,
            ...Object.fromEntries(
              Object.values(MACROS).map((m) => [m.name, m.description ?? "G-Code macro"]),
            ),
          });
        case "server.gcode_store":
          return reply({ gcode_store: this.gcodeStore.slice(-Number(params.count ?? 1000)) });
        case "printer.objects.subscribe": {
          if (klippyState !== "ready") return fail(503, "Klippy not ready");
          const status: Objects = {};
          for (const name of Object.keys(params.objects ?? {}))
            if (this.objects[name]) status[name] = { ...this.objects[name] };
          return reply({ eventtime: Date.now() / 1000, status });
        }
        case "printer.print.start":
          if (!this.files[String(params.filename)])
            return fail(400, `File ${params.filename} does not exist`);
          this.jobs.unshift({
            job_id: String(this.jobs.length + 1).padStart(6, "0"),
            filename: String(params.filename),
            status: "in_progress",
            start_time: now(),
            end_time: null,
            print_duration: 0,
            filament_used: 0,
          });
          // Notify clients with everything the new print changed.
          this.update(this.startPrint(String(params.filename)));
          return reply("ok");
        case "server.files.get_directory": {
          const base = String(params.path ?? "gcodes").replace(/^gcodes\/?/, "");
          const prefix = base ? `${base}/` : "";
          const inDir = Object.entries(this.files).filter(([path]) => path.startsWith(prefix));
          const files = inDir
            .filter(([path]) => !path.slice(prefix.length).includes("/"))
            .map(([path, meta]) => {
              const filename = path.slice(prefix.length);
              return {
                filename,
                ...meta,
                layer_height: 0.2,
                object_height: 48,
                slicer: "OrcaSlicer",
                thumbnails: [
                  {
                    width: 32,
                    height: 32,
                    relative_path: `.thumbs/${filename.replace(/\.gcode$/, "")}-32x32.png`,
                  },
                  {
                    width: 300,
                    height: 300,
                    relative_path: `.thumbs/${filename.replace(/\.gcode$/, "")}-300x300.png`,
                  },
                ],
              };
            });
          const dirs = [
            ...new Set(
              inDir
                .map(([path]) => path.slice(prefix.length))
                .filter((rest) => rest.includes("/"))
                .map((rest) => rest.split("/")[0]),
            ),
          ];
          return reply({ dirs: [...dirs, ".thumbs"].map((dirname) => ({ dirname })), files });
        }
        case "server.files.delete_file": {
          const path = String(params.path).replace(/^gcodes\//, "");
          if (!this.files[path]) return fail(404, "File does not exist");
          delete this.files[path];
          return reply({ item: { path, root: "gcodes" } });
        }
        case "server.history.list":
          return reply({
            count: this.jobs.length,
            jobs: this.jobs.slice(
              Number(params.start ?? 0),
              Number(params.start ?? 0) + Number(params.limit ?? 50),
            ),
          });
        case "server.history.totals":
          return reply({
            job_totals: {
              total_jobs: this.jobs.length,
              total_print_time: this.jobs.reduce((sum, job) => sum + job.print_duration, 0),
              total_filament_used: this.jobs.reduce((sum, job) => sum + job.filament_used, 0),
            },
          });
        case "printer.print.pause":
          this.update({ print_stats: { state: "paused" } });
          return reply("ok");
        case "printer.print.resume":
          this.update({ print_stats: { state: "printing" } });
          return reply("ok");
        case "printer.print.cancel":
          if (this.jobs[0]?.status === "in_progress")
            Object.assign(this.jobs[0], { status: "cancelled", end_time: now() });
          this.update({
            print_stats: { state: "cancelled" },
            extruder: { target: 0 },
            heater_bed: { target: 0 },
          });
          return reply("ok");
        case "printer.emergency_stop":
          this.setKlippyState("shutdown");
          return reply("ok");
        case "server.temperature_store":
          return reply(this.history);
        case "server.webcams.list":
          return reply({
            webcams: [
              {
                name: "Nozzle cam",
                enabled: true,
                service: "mjpegstreamer",
                stream_url: `${this.url}/webcam/?action=stream`,
                snapshot_url: `${this.url}/webcam/?action=snapshot`,
                flip_horizontal: false,
                flip_vertical: false,
                rotation: 0,
              },
            ],
          });
        case "printer.gcode.script": {
          this.gcodeStore.push({ message: String(params.script), time: now(), type: "command" });
          const error = this.runGcode(String(params.script));
          if (error) {
            this.respond(`!! ${error}`);
            return fail(400, error);
          }
          this.gcode.push(String(params.script));
          this.respond("ok");
          return reply("ok");
        }
        default:
          return fail(-32601, `Method not found: ${method}`);
      }
    });
  }
}
