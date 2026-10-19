import type {
  PrinterConnection,
  PrinterDriver,
  PrinterDriverFactory,
  PrinterInfo,
  PrinterState,
  PrinterStatus,
  TemperatureReading,
} from "@printrio/sdk";

/**
 * Klipper via Moonraker (https://moonraker.readthedocs.io). Talks JSON-RPC 2.0
 * over Moonraker's /websocket endpoint and subscribes to Klipper printer
 * objects; file uploads use the HTTP API.
 */

const REQUEST_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 8_000;

/** Klipper objects we read status from; heaters/sensors are discovered at runtime. */
const BASE_OBJECTS: Record<string, string[] | null> = {
  webhooks: ["state", "state_message"],
  print_stats: ["state", "filename", "print_duration", "filament_used", "message"],
  virtual_sdcard: ["progress"],
  display_status: ["progress", "message"],
};
const HEATER_PATTERN = /^(extruder\d*|heater_bed|heater_generic .+|temperature_sensor .+)$/;

type KlipperObjects = Record<string, Record<string, unknown>>;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class MoonrakerError extends Error {}

export function toWebSocketUrl(httpUrl: string): string {
  const url = new URL(httpUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/websocket`;
  return url.toString();
}

/** Maps Klipper object state to the driver-neutral status. Exported for tests. */
export function toPrinterStatus(objects: KlipperObjects, heaters: string[]): PrinterStatus {
  const webhooks = objects.webhooks ?? {};
  const printStats = objects.print_stats ?? {};
  const klippyState = String(webhooks.state ?? "startup");

  let state: PrinterState;
  if (klippyState === "shutdown" || klippyState === "error") state = "error";
  else if (klippyState !== "ready") state = "connecting";
  else {
    const printState = String(printStats.state ?? "standby");
    state =
      printState === "printing"
        ? "printing"
        : printState === "paused"
          ? "paused"
          : printState === "error"
            ? "error"
            : "idle";
  }

  const temperatures: TemperatureReading[] = heaters.flatMap((name) => {
    const heater = objects[name];
    if (!heater || typeof heater.temperature !== "number") return [];
    const target = typeof heater.target === "number" ? heater.target : null;
    return [{ name: displayHeaterName(name), current: heater.temperature, target }];
  });

  let job: PrinterStatus["job"] = null;
  if (state === "printing" || state === "paused") {
    const progress = Number(
      objects.virtual_sdcard?.progress ?? objects.display_status?.progress ?? 0,
    );
    const elapsed = Number(printStats.print_duration ?? 0);
    job = {
      fileName: String(printStats.filename ?? ""),
      progress,
      elapsedSeconds: elapsed,
      remainingSeconds: progress > 0.01 ? Math.max(0, elapsed / progress - elapsed) : null,
      filamentUsedMm: Number(printStats.filament_used ?? 0),
    };
  }

  const message =
    state === "error" || state === "connecting"
      ? String(webhooks.state_message ?? "") || null
      : String(printStats.message ?? objects.display_status?.message ?? "") || null;

  return { state, message, temperatures, job, updatedAt: new Date() };
}

function displayHeaterName(name: string) {
  return name.replace(/^(heater_generic|temperature_sensor) /, "");
}

function mergeObjects(target: KlipperObjects, update: KlipperObjects) {
  for (const [name, fields] of Object.entries(update)) {
    target[name] = { ...target[name], ...fields };
  }
}

export class MoonrakerDriver implements PrinterDriver {
  readonly id = "moonraker";

  private socket: WebSocket | null = null;
  private connection: PrinterConnection | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private objects: KlipperObjects = {};
  private heaters: string[] = [];
  private status: PrinterStatus = toPrinterStatus({}, []);
  private info: PrinterInfo = { hostname: null, firmwareState: null };
  private statusListeners = new Set<(status: PrinterStatus) => void>();
  private consoleListeners = new Set<(line: string) => void>();
  private disconnectListeners = new Set<() => void>();
  private closedByUs = false;

  async connect(connection: PrinterConnection): Promise<void> {
    this.connection = connection;
    this.closedByUs = false;
    const socket = new WebSocket(toWebSocketUrl(connection.url));
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new MoonrakerError("Timed out connecting to Moonraker."));
        socket.close();
      }, CONNECT_TIMEOUT_MS);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new MoonrakerError("Could not reach Moonraker at this address."));
      });
    });

    socket.addEventListener("message", (event) => this.handleMessage(String(event.data)));
    socket.addEventListener("close", () => this.handleClose());

    await this.call("server.connection.identify", {
      client_name: "Printrio",
      version: "0.1.0",
      type: "other",
      url: "https://printrio.app",
      ...(connection.apiKey ? { api_key: connection.apiKey } : {}),
    });
    const server = (await this.call("server.info")) as { klippy_state?: string };
    this.info.firmwareState = server.klippy_state ?? null;
    await this.initKlippy();
  }

  async disconnect(): Promise<void> {
    this.closedByUs = true;
    this.socket?.close();
    this.socket = null;
    this.rejectPending(new MoonrakerError("Disconnected."));
  }

  async getInfo(): Promise<PrinterInfo> {
    return { ...this.info };
  }

  async getStatus(): Promise<PrinterStatus> {
    return this.status;
  }

  onStatus(listener: (status: PrinterStatus) => void) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onConsole(listener: (line: string) => void) {
    this.consoleListeners.add(listener);
    return () => this.consoleListeners.delete(listener);
  }

  onDisconnect(listener: () => void) {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  async uploadFile(name: string, data: AsyncIterable<Uint8Array>): Promise<void> {
    if (!this.connection) throw new MoonrakerError("Not connected.");
    const chunks: Uint8Array[] = [];
    for await (const chunk of data) chunks.push(chunk);
    const form = new FormData();
    form.append("root", "gcodes");
    form.append("file", new Blob(chunks.map((chunk) => new Uint8Array(chunk))), name);
    const res = await fetch(`${this.connection.url}/server/files/upload`, {
      method: "POST",
      headers: this.connection.apiKey ? { "X-Api-Key": this.connection.apiKey } : {},
      body: form,
    });
    if (!res.ok) throw new MoonrakerError(`Upload failed (${res.status}).`);
  }

  async startPrint(fileName: string) {
    await this.call("printer.print.start", { filename: fileName });
  }
  async pause() {
    await this.call("printer.print.pause");
  }
  async resume() {
    await this.call("printer.print.resume");
  }
  async cancel() {
    await this.call("printer.print.cancel");
  }
  async emergencyStop() {
    await this.call("printer.emergency_stop");
  }
  async sendGcode(script: string) {
    await this.call("printer.gcode.script", { script });
  }

  /** Discovers heaters and subscribes to status; called on connect and whenever Klippy becomes ready. */
  private async initKlippy() {
    const info = (await this.call("printer.info").catch(() => null)) as {
      state?: string;
      hostname?: string;
    } | null;
    if (info?.hostname) this.info.hostname = info.hostname;
    if (info?.state) this.info.firmwareState = info.state;
    this.objects = { webhooks: { state: info?.state ?? "startup" } };
    if (info?.state !== "ready") {
      this.publish();
      return;
    }
    const list = (await this.call("printer.objects.list")) as { objects: string[] };
    this.heaters = list.objects.filter((name) => HEATER_PATTERN.test(name));
    const objects: Record<string, string[] | null> = { ...BASE_OBJECTS };
    for (const heater of this.heaters) objects[heater] = ["temperature", "target"];
    const result = (await this.call("printer.objects.subscribe", { objects })) as {
      status: KlipperObjects;
    };
    mergeObjects(this.objects, result.status);
    this.publish();
  }

  private publish() {
    this.status = toPrinterStatus(this.objects, this.heaters);
    for (const listener of this.statusListeners) listener(this.status);
  }

  private call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new MoonrakerError("Not connected."));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new MoonrakerError(`Moonraker did not answer ${method}.`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ jsonrpc: "2.0", method, params, id }));
    });
  }

  private handleMessage(raw: string) {
    let message: {
      id?: number;
      result?: unknown;
      error?: { message?: string };
      method?: string;
      params?: unknown[];
    };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error)
        pending.reject(new MoonrakerError(message.error.message ?? "Moonraker error."));
      else pending.resolve(message.result);
      return;
    }
    switch (message.method) {
      case "notify_status_update":
        mergeObjects(this.objects, (message.params?.[0] ?? {}) as KlipperObjects);
        this.publish();
        break;
      case "notify_klippy_ready":
        this.initKlippy().catch(() => {});
        break;
      case "notify_klippy_shutdown":
        this.objects.webhooks = { ...this.objects.webhooks, state: "shutdown" };
        this.publish();
        break;
      case "notify_klippy_disconnected":
        this.objects.webhooks = { ...this.objects.webhooks, state: "startup" };
        this.publish();
        break;
      case "notify_gcode_response":
        for (const line of (message.params ?? []) as string[]) {
          for (const listener of this.consoleListeners) listener(String(line));
        }
        break;
    }
  }

  private handleClose() {
    this.rejectPending(new MoonrakerError("Connection closed."));
    this.socket = null;
    this.status = { ...toPrinterStatus({}, []), state: "offline", message: null };
    for (const listener of this.statusListeners) listener(this.status);
    if (!this.closedByUs) for (const listener of this.disconnectListeners) listener();
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export const moonrakerDriverFactory: PrinterDriverFactory = {
  id: "moonraker",
  displayName: "Klipper (Moonraker)",
  create: () => new MoonrakerDriver(),
};
