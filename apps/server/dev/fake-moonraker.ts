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
  /** Progress added per tick while printing. */
  progressPerTick?: number;
}

type Objects = Record<string, Record<string, unknown>>;

export class FakeMoonraker {
  readonly gcode: string[] = [];
  readonly uploads: string[] = [];
  private server: Server;
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private objects: Objects;

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
    };
    if (options.printing) this.startPrint(options.printing.fileName, options.printing.progress);

    this.server = createServer((req, res) => {
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
          this.uploads.push(name);
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
    const update: Objects = {
      extruder: { temperature: approach(Number(extruder.temperature), Number(extruder.target)) },
      heater_bed: { temperature: approach(Number(bed.temperature), Number(bed.target)) },
    };
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
        update.extruder = { ...update.extruder, target: 0 };
        update.heater_bed = { ...update.heater_bed, target: 0 };
      }
    }
    this.update(update);
  }

  private startPrint(fileName: string, progress = 0) {
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
    };
    for (const [name, fields] of Object.entries(objects))
      this.objects[name] = { ...this.objects[name], ...fields };
  }

  private update(changes: Objects) {
    for (const [name, fields] of Object.entries(changes))
      this.objects[name] = { ...this.objects[name], ...fields };
    this.notify("notify_status_update", [changes, Date.now() / 1000]);
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
        case "printer.objects.subscribe": {
          if (klippyState !== "ready") return fail(503, "Klippy not ready");
          const status: Objects = {};
          for (const name of Object.keys(params.objects ?? {}))
            if (this.objects[name]) status[name] = { ...this.objects[name] };
          return reply({ eventtime: Date.now() / 1000, status });
        }
        case "printer.print.start":
          this.startPrint(String(params.filename));
          this.update({});
          return reply("ok");
        case "printer.print.pause":
          this.update({ print_stats: { state: "paused" } });
          return reply("ok");
        case "printer.print.resume":
          this.update({ print_stats: { state: "printing" } });
          return reply("ok");
        case "printer.print.cancel":
          this.update({
            print_stats: { state: "cancelled" },
            extruder: { target: 0 },
            heater_bed: { target: 0 },
          });
          return reply("ok");
        case "printer.emergency_stop":
          this.setKlippyState("shutdown");
          return reply("ok");
        case "printer.gcode.script":
          this.gcode.push(String(params.script));
          this.notify("notify_gcode_response", [`// ${params.script}`]);
          this.notify("notify_gcode_response", ["ok"]);
          return reply("ok");
        default:
          return fail(-32601, `Method not found: ${method}`);
      }
    });
  }
}
