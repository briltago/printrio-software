import type {
  Axis,
  BedMesh,
  BedMeshAction,
  ConfigFile,
  ConsoleEntry,
  FileListing,
  GcodeCommand,
  HostAction,
  HostService,
  JobStatus,
  LogFile,
  Macro,
  MotionStatus,
  ObjectExclusion,
  PowerDevice,
  PrinterConnection,
  PrinterDriver,
  PrinterDriverFactory,
  PrinterInfo,
  PrinterState,
  PrinterStatus,
  PrintFile,
  PrintJob,
  SystemInfo,
  SystemStats,
  TemperatureHistory,
  TemperatureReading,
  Webcam,
} from "@printrio/sdk";

/**
 * Klipper via Moonraker (https://moonraker.readthedocs.io). Talks JSON-RPC 2.0
 * over Moonraker's /websocket endpoint and subscribes to Klipper printer
 * objects; file uploads use the HTTP API.
 */

const REQUEST_TIMEOUT_MS = 10_000;
const GCODE_TIMEOUT_MS = 30 * 60_000;
const CONNECT_TIMEOUT_MS = 6_000;
const PROBE_TIMEOUT_MS = 5_000;

/** Klipper objects we read status from; heaters/sensors are discovered at runtime. */
const BASE_OBJECTS: Record<string, string[] | null> = {
  webhooks: ["state", "state_message"],
  print_stats: ["state", "filename", "print_duration", "filament_used", "message"],
  virtual_sdcard: ["progress"],
  display_status: ["progress", "message"],
};
/** Optional objects: subscribed only when the printer has them. */
const OPTIONAL_OBJECTS: Record<string, string[]> = {
  toolhead: ["homed_axes", "axis_minimum", "axis_maximum"],
  gcode_move: ["gcode_position", "homing_origin", "speed_factor", "extrude_factor"],
  exclude_object: ["objects", "excluded_objects", "current_object"],
};
const AXES: Axis[] = ["x", "y", "z"];

/**
 * Fans: the standard part fan, generic and automatic fans, and output pins
 * named like fans — Creality firmware drives its part fan as `output_pin fan0`.
 */
const FAN_PATTERN = /^(fan|fan_generic .+|heater_fan .+|controller_fan .+|output_pin \S*fan\S*)$/i;
const isControllableFan = (id: string) => /^(fan|fan_generic .+|output_pin .+)$/.test(id);
const fanFields = (id: string) => (id.startsWith("output_pin ") ? ["value"] : ["speed"]);
const fanDisplayName = (id: string) =>
  id.replace(/^(fan_generic|heater_fan|controller_fan|output_pin) /, "");
/** Jog feed rates in mm/min, as in Mainsail's defaults. */
const JOG_FEED = { xy: 6000, z: 600 };
const num = (value: number) => String(Math.round(value * 1000) / 1000);

const HEATER_PATTERN = /^(extruder\d*|heater_bed|heater_generic .+|temperature_sensor .+)$/;

type KlipperObjects = Record<string, Record<string, unknown>>;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Parameters a Klipper macro reads, from its Jinja template: `params.X`,
 * `params["X"]` and an optional `|default(...)`. Klipper upper-cases
 * parameter names, so they are reported upper-case.
 */
export function parseMacroParams(gcode: string): { name: string; defaultValue: string | null }[] {
  const pattern =
    /params\s*(?:\.\s*([A-Za-z_][A-Za-z0-9_]*)|\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\])(?:\s*\|\s*default\(\s*([^)]*?)\s*\))?/g;
  const params = new Map<string, string | null>();
  for (const match of gcode.matchAll(pattern)) {
    const name = (match[1] ?? match[2] ?? "").toUpperCase();
    const fallback = match[3]?.replace(/^(["'])(.*)\1$/, "$2") ?? null;
    if (!params.has(name) || (params.get(name) === null && fallback !== null))
      params.set(name, fallback);
  }
  return [...params].map(([name, defaultValue]) => ({ name, defaultValue }));
}

export class MoonrakerError extends Error {}

interface MoonrakerBedMesh {
  profile_name?: string;
  mesh_min?: unknown;
  mesh_max?: unknown;
  probed_matrix?: unknown;
  mesh_matrix?: unknown;
  profiles?: Record<
    string,
    {
      points?: unknown;
      mesh_params?: { min_x?: number; max_x?: number; min_y?: number; max_y?: number };
    }
  >;
}

function toPoint(value: unknown): [number, number] | null {
  if (!Array.isArray(value)) return null;
  const [x, y] = value;
  return typeof x === "number" && typeof y === "number" ? [x, y] : null;
}

/** Klipper reports "no mesh" as `[[]]`; keep only non-empty numeric rows. */
function toMatrix(value: unknown): number[][] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is unknown[] => Array.isArray(row) && row.length > 0)
    .map((row) => row.map((z) => Number(z)));
}

interface MoonrakerSystemInfo {
  cpu_info?: {
    cpu_count?: number;
    total_memory?: number;
    model?: string;
    cpu_desc?: string;
    processor?: string;
  };
  distribution?: { name?: string; kernel_version?: string };
  python?: { version_string?: string };
  network?: Record<string, { ip_addresses?: { address?: string; is_link_local?: boolean }[] }>;
}

export function toWebSocketUrl(httpUrl: string): string {
  const url = new URL(httpUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/websocket`;
  return url.toString();
}

/** Nozzles first, then the bed, other heaters, and passive sensors (MCU, chamber) last. */
function heaterRank(name: string) {
  if (name.startsWith("extruder")) return 0;
  if (name === "heater_bed") return 1;
  if (name.startsWith("heater_generic")) return 2;
  return 3;
}

export function sortHeaters(names: string[]) {
  return [...names].sort((a, b) => heaterRank(a) - heaterRank(b) || a.localeCompare(b));
}

/** Maps Klipper object state to the driver-neutral status. Exported for tests. */
export function toPrinterStatus(
  objects: KlipperObjects,
  heaters: string[],
  fans: string[] = [],
): PrinterStatus {
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

  const temperatures: TemperatureReading[] = sortHeaters(heaters).flatMap((name) => {
    const heater = objects[name];
    if (!heater || typeof heater.temperature !== "number") return [];
    const target = typeof heater.target === "number" ? heater.target : null;
    return [
      {
        id: name,
        name: displayHeaterName(name),
        current: heater.temperature,
        target,
        controllable: isControllable(name),
        power: typeof heater.power === "number" ? heater.power : null,
      },
    ];
  });

  const fanStatuses = fans.flatMap((id) => {
    const fan = objects[id];
    if (!fan) return [];
    // output_pin reports `value` already normalised to 0–1 by Klipper (value / scale).
    const speed = Number(id.startsWith("output_pin ") ? fan.value : fan.speed);
    return [
      {
        id,
        name: fanDisplayName(id),
        speed: Number.isFinite(speed) ? speed : 0,
        controllable: isControllableFan(id),
      },
    ];
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

  return {
    state,
    message,
    temperatures,
    job,
    motion: toMotion(objects),
    fans: fanStatuses,
    exclusion: state === "printing" || state === "paused" ? toExclusion(objects) : null,
    updatedAt: new Date(),
  };
}

const xyz = (value: unknown): Record<Axis, number> | null =>
  Array.isArray(value) && value.length >= 3
    ? { x: Number(value[0]), y: Number(value[1]), z: Number(value[2]) }
    : null;

function toMotion(objects: KlipperObjects): MotionStatus | null {
  const move = objects.gcode_move;
  const toolhead = objects.toolhead;
  const position = xyz(move?.gcode_position);
  if (!move || !toolhead || !position) return null;
  const homed = String(toolhead.homed_axes ?? "");
  return {
    position,
    homedAxes: AXES.filter((axis) => homed.includes(axis)),
    min: xyz(toolhead.axis_minimum),
    max: xyz(toolhead.axis_maximum),
    zOffset: xyz(move.homing_origin)?.z ?? 0,
    speedFactor: Number(move.speed_factor ?? 1),
    flowFactor: Number(move.extrude_factor ?? 1),
  };
}

function toExclusion(objects: KlipperObjects): ObjectExclusion | null {
  const exclusion = objects.exclude_object;
  if (!exclusion || !Array.isArray(exclusion.objects) || exclusion.objects.length === 0)
    return null;
  return {
    objects: exclusion.objects
      .map((object: { name?: string }) => String(object.name ?? ""))
      .filter(Boolean),
    excluded: Array.isArray(exclusion.excluded_objects)
      ? exclusion.excluded_objects.map(String)
      : [],
    current: exclusion.current_object ? String(exclusion.current_object) : null,
  };
}

const isControllable = (name: string) => /^(extruder\d*|heater_bed|heater_generic .+)$/.test(name);

/** The HEATER= parameter of SET_HEATER_TEMPERATURE: heater_generic objects use their short name. */
export const heaterParam = (id: string) => id.replace(/^heater_generic /, "");

/**
 * Moonraker returns webcam URLs as configured, often relative to the printer's
 * web server (port 80, e.g. "/webcam/?action=stream") rather than to Moonraker.
 */
export function resolveWebcamUrl(printerUrl: string, value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const base = new URL(printerUrl);
  try {
    return new URL(value, `${base.protocol}//${base.hostname}`).toString();
  } catch {
    return null;
  }
}

function displayHeaterName(name: string) {
  return name.replace(/^(heater_generic|temperature_sensor) /, "");
}

function mergeObjects(target: KlipperObjects, update: KlipperObjects) {
  for (const [name, fields] of Object.entries(update)) {
    target[name] = { ...target[name], ...fields };
  }
}

const TLS_MISMATCH = /^(ERR_SSL_|EPROTO)/;
const UNTRUSTED_CERT = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/** Throws a MoonrakerError with an actionable explanation when the address is not a reachable Moonraker. */
export async function probeMoonraker(connection: PrinterConnection) {
  const url = new URL(connection.url);
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  let res: Response;
  try {
    res = await fetch(`${connection.url}/server/info`, {
      headers: connection.apiKey ? { "X-Api-Key": connection.apiKey } : {},
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (error) {
    const code = String((error as { cause?: { code?: string } }).cause?.code ?? "");
    if (url.protocol === "https:" && TLS_MISMATCH.test(code)) {
      throw new MoonrakerError(
        `The printer doesn't use HTTPS on port ${port}. Use http:// instead of https://.`,
      );
    }
    if (UNTRUSTED_CERT.has(code)) {
      throw new MoonrakerError(
        "The printer's HTTPS certificate isn't trusted. Use http:// on your local network, or a trusted certificate.",
      );
    }
    if (code === "ECONNREFUSED") {
      throw new MoonrakerError(
        `Nothing is listening on ${url.hostname}:${port}. Check that Moonraker is running and the port (usually 7125).`,
      );
    }
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      throw new MoonrakerError(
        `The name "${url.hostname}" could not be resolved. Try the printer's IP address.`,
      );
    }
    throw new MoonrakerError(
      `No response from ${url.hostname}:${port}. Check the address, and that the machine running Printrio can reach the printer's network (for a hosted server, use Tailscale).`,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new MoonrakerError(
      connection.apiKey
        ? "Moonraker rejected the API key."
        : "Moonraker requires authentication. Add an API key, or add Printrio's address to trusted_clients in moonraker.conf.",
    );
  }
  const body = (await res.json().catch(() => null)) as {
    result?: { klippy_state?: unknown };
  } | null;
  if (!res.ok || !body?.result) {
    throw new MoonrakerError(
      `Something answered on port ${port}, but it isn't Moonraker. Moonraker usually uses port 7125 (the web interface runs on a different port).`,
    );
  }
}

const GCODE_EXTENSIONS = /\.(gcode|g|gco|ufp)$/i;

interface MoonrakerFile {
  filename: string;
  modified: number;
  size: number;
  estimated_time?: number;
  filament_total?: number;
  filament_weight_total?: number;
  layer_height?: number;
  object_height?: number;
  slicer?: string;
  thumbnails?: { width: number; height: number; relative_path: string }[];
}

interface MoonrakerJob {
  job_id: string;
  filename: string;
  status: string;
  start_time: number;
  end_time: number | null;
  print_duration: number;
  filament_used: number;
  metadata?: { thumbnails?: MoonrakerFile["thumbnails"] };
}

const optionalNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const directoryOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";

/** Largest thumbnail; its path is relative to the G-code file's directory. */
function largestThumbnail(directory: string, thumbnails: MoonrakerFile["thumbnails"]) {
  const best = [...(thumbnails ?? [])].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  return best ? `${directory}${best.relative_path}` : null;
}

function toPrintFile(prefix: string, file: MoonrakerFile): PrintFile {
  return {
    path: `${prefix}${file.filename}`,
    size: file.size,
    modified: new Date(file.modified * 1000),
    estimatedSeconds: optionalNumber(file.estimated_time),
    filamentMm: optionalNumber(file.filament_total),
    filamentGrams: optionalNumber(file.filament_weight_total),
    layerHeight: optionalNumber(file.layer_height),
    objectHeight: optionalNumber(file.object_height),
    slicer: file.slicer ?? null,
    thumbnailPath: largestThumbnail(prefix, file.thumbnails),
  };
}

const JOB_STATUS: Record<string, JobStatus> = {
  completed: "completed",
  cancelled: "cancelled",
  error: "error",
  in_progress: "in_progress",
};

function toPrintJob(job: MoonrakerJob): PrintJob {
  return {
    id: job.job_id,
    fileName: job.filename,
    // klippy_shutdown, klippy_disconnect, server_exit, interrupted
    status: JOB_STATUS[job.status] ?? "interrupted",
    startedAt: new Date(job.start_time * 1000),
    endedAt: job.end_time ? new Date(job.end_time * 1000) : null,
    printSeconds: job.print_duration ?? 0,
    filamentMm: job.filament_used ?? 0,
    thumbnailPath: largestThumbnail(directoryOf(job.filename), job.metadata?.thumbnails),
  };
}

export class MoonrakerDriver implements PrinterDriver {
  readonly id = "moonraker";

  private socket: WebSocket | null = null;
  private connection: PrinterConnection | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private objects: KlipperObjects = {};
  private heaters: string[] = [];
  private fans: string[] = [];
  private pinScales: Record<string, number> = {};
  private status: PrinterStatus = toPrinterStatus({}, []);
  private info: PrinterInfo = { hostname: null, firmwareState: null };
  private statusListeners = new Set<(status: PrinterStatus) => void>();
  private consoleListeners = new Set<(line: string) => void>();
  private disconnectListeners = new Set<() => void>();
  private closedByUs = false;

  async connect(connection: PrinterConnection): Promise<void> {
    this.connection = connection;
    this.closedByUs = false;
    // A plain HTTP request first: its errors say much more than a failed websocket.
    await probeMoonraker(connection);
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

  async uploadFile(path: string, data: AsyncIterable<Uint8Array>): Promise<void> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of data) chunks.push(chunk);
    await this.upload("gcodes", path, new Blob(chunks.map((chunk) => new Uint8Array(chunk))));
  }

  /** Multipart upload into a Moonraker file root; `path` may include sub-directories. */
  private async upload(root: string, path: string, blob: Blob) {
    if (!this.connection) throw new MoonrakerError("Not connected.");
    const slash = path.lastIndexOf("/");
    const form = new FormData();
    form.append("root", root);
    if (slash > 0) form.append("path", path.slice(0, slash));
    form.append("file", blob, path.slice(slash + 1));
    const res = await fetch(`${this.connection.url}/server/files/upload`, {
      method: "POST",
      headers: this.authHeaders(),
      body: form,
    });
    if (!res.ok) throw new MoonrakerError(`Upload failed (${res.status}).`);
  }

  /** Raw file from a Moonraker file root over HTTP. */
  private async download(
    root: string,
    path: string,
    { range, timeoutMs = 10_000 }: { range?: string; timeoutMs?: number } = {},
  ) {
    if (!this.connection) throw new MoonrakerError("Not connected.");
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`${this.connection.url}/server/files/${root}/${encoded}`, {
      headers: { ...this.authHeaders(), ...(range ? { Range: range } : {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok || !res.body) throw new MoonrakerError(`File not available (${res.status}).`);
    return res;
  }

  async startPrint(path: string) {
    await this.call("printer.print.start", { filename: path });
  }

  async listFiles(directory: string): Promise<FileListing> {
    const result = (await this.call("server.files.get_directory", {
      path: directory ? `gcodes/${directory}` : "gcodes",
      extended: true,
    })) as { dirs?: { dirname: string }[]; files?: MoonrakerFile[] };
    const prefix = directory ? `${directory}/` : "";
    return {
      // Hidden directories hold thumbnails (.thumbs) and slicer caches.
      directories: (result.dirs ?? [])
        .map((dir) => dir.dirname)
        .filter((name) => !name.startsWith("."))
        .sort(),
      files: (result.files ?? [])
        .filter((file) => GCODE_EXTENSIONS.test(file.filename))
        .map((file) => toPrintFile(prefix, file)),
    };
  }

  async deleteFile(path: string) {
    await this.call("server.files.delete_file", { path: `gcodes/${path}` });
  }

  async readFile(path: string) {
    const res = await this.download("gcodes", path);
    return {
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      body: res.body as unknown as AsyncIterable<Uint8Array>,
    };
  }

  async listJobs(limit: number, offset: number) {
    const [history, totals] = (await Promise.all([
      this.call("server.history.list", { limit, start: offset, order: "desc" }),
      this.call("server.history.totals"),
    ])) as [{ jobs?: MoonrakerJob[] }, { job_totals?: Record<string, number> }];
    return {
      jobs: (history.jobs ?? []).map(toPrintJob),
      totals: {
        jobs: Number(totals.job_totals?.total_jobs ?? 0),
        printSeconds: Number(totals.job_totals?.total_print_time ?? 0),
        filamentMm: Number(totals.job_totals?.total_filament_used ?? 0),
      },
    };
  }

  async getConsoleHistory(count: number): Promise<ConsoleEntry[]> {
    const result = (await this.call("server.gcode_store", { count })) as {
      gcode_store?: { message?: string; time?: number; type?: string }[];
    };
    return (result.gcode_store ?? []).map((entry) => ({
      time: new Date(Number(entry.time ?? 0) * 1000),
      kind: entry.type === "command" ? "command" : "response",
      message: String(entry.message ?? ""),
    }));
  }

  async listMacros(): Promise<Macro[]> {
    const [list, query] = (await Promise.all([
      this.call("printer.objects.list"),
      this.call("printer.objects.query", { objects: { configfile: ["config"] } }),
    ])) as [
      { objects?: string[] },
      { status?: { configfile?: { config?: Record<string, Record<string, string>> } } },
    ];
    const config = query.status?.configfile?.config ?? {};
    return (list.objects ?? [])
      .filter((name) => name.startsWith("gcode_macro "))
      .map((object) => {
        const section = config[object.toLowerCase()] ?? {};
        return {
          name: object.slice("gcode_macro ".length),
          description: section.description?.trim() || null,
          params: parseMacroParams(section.gcode ?? ""),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listGcodeCommands(): Promise<GcodeCommand[]> {
    const help = (await this.call("printer.gcode.help")) as Record<string, string>;
    return Object.entries(help)
      .map(([name, description]) => ({ name, description: description || null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listConfigFiles(): Promise<ConfigFile[]> {
    const files = (await this.call("server.files.list", { root: "config" })) as {
      path?: string;
      filename?: string;
      size?: number;
      modified?: number;
    }[];
    return files
      .map((file) => ({
        path: String(file.path ?? file.filename ?? ""),
        size: Number(file.size ?? 0),
        modified: new Date(Number(file.modified ?? 0) * 1000),
      }))
      .filter((file) => file.path && !file.path.split("/").some((part) => part.startsWith(".")))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async readConfigFile(path: string) {
    return (await this.download("config", path)).text();
  }

  async writeConfigFile(path: string, content: string) {
    await this.upload("config", path, new Blob([content], { type: "text/plain" }));
  }

  async restartFirmware(firmware: boolean) {
    await this.call(firmware ? "printer.firmware_restart" : "printer.restart");
  }

  async listServices(): Promise<HostService[]> {
    const result = (await this.call("machine.system_info")) as {
      system_info?: {
        available_services?: string[];
        service_state?: Record<string, { active_state?: string }>;
      };
    };
    const info = result.system_info ?? {};
    return (info.available_services ?? []).map((name) => ({
      name,
      state: info.service_state?.[name]?.active_state ?? null,
    }));
  }

  async restartService(name: string) {
    await this.call("machine.services.restart", { service: name });
  }

  async hostPower(action: HostAction) {
    await this.call(action === "reboot" ? "machine.reboot" : "machine.shutdown");
  }

  async listLogs(): Promise<LogFile[]> {
    const files = (await this.call("server.files.list", { root: "logs" })) as {
      path?: string;
      filename?: string;
      size?: number;
      modified?: number;
    }[];
    return files
      .map((file) => ({
        name: String(file.path ?? file.filename ?? ""),
        size: Number(file.size ?? 0),
        modified: new Date(Number(file.modified ?? 0) * 1000),
      }))
      .filter((file) => file.name && !file.name.startsWith("."))
      .sort((a, b) => b.modified.getTime() - a.modified.getTime());
  }

  async readLog(name: string, fromEnd?: number) {
    const res = await this.download("logs", name, {
      range: fromEnd ? `bytes=-${fromEnd}` : undefined,
      timeoutMs: 120_000,
    });
    // A suffix range on a small file still answers 206, but starting at byte 0.
    const start = Number(/^bytes (\d+)-/.exec(res.headers.get("content-range") ?? "")?.[1] ?? 0);
    return {
      partial: res.status === 206 && start > 0,
      body: res.body as unknown as AsyncIterable<Uint8Array>,
    };
  }

  async getSystemInfo(): Promise<SystemInfo> {
    const [system, printer, server] = (await Promise.all([
      this.call("machine.system_info"),
      this.call("printer.info").catch(() => null),
      this.call("server.info").catch(() => null),
    ])) as [
      { system_info?: MoonrakerSystemInfo },
      { hostname?: string; software_version?: string } | null,
      { moonraker_version?: string } | null,
    ];
    const info = system.system_info ?? {};
    const cpu = info.cpu_info ?? {};
    const memoryKb = Number(cpu.total_memory);
    return {
      hostname: printer?.hostname ?? this.info.hostname,
      os: info.distribution?.name || null,
      kernel: info.distribution?.kernel_version || null,
      cpu: cpu.model || cpu.cpu_desc || cpu.processor || null,
      cpuCores: Number(cpu.cpu_count) || null,
      memoryTotal: Number.isFinite(memoryKb) && memoryKb > 0 ? memoryKb * 1024 : null,
      python: info.python?.version_string?.split(" ")[0] ?? null,
      firmwareVersion: printer?.software_version ?? null,
      hostSoftwareVersion: server?.moonraker_version ?? null,
      network: Object.entries(info.network ?? {}).map(([name, iface]) => ({
        name,
        addresses: (iface.ip_addresses ?? [])
          .filter((address) => !address.is_link_local)
          .map((address) => String(address.address)),
      })),
    };
  }

  async getSystemStats(): Promise<SystemStats> {
    const stats = (await this.call("machine.proc_stats")) as {
      cpu_temp?: number | null;
      system_cpu_usage?: { cpu?: number };
      system_memory?: { total?: number; used?: number };
      system_uptime?: number;
    };
    const kb = (value: number | undefined) => (typeof value === "number" ? value * 1024 : null);
    return {
      cpuUsage: optionalNumber(stats.system_cpu_usage?.cpu),
      cpuTemp: optionalNumber(stats.cpu_temp),
      memoryUsed: kb(stats.system_memory?.used),
      memoryTotal: kb(stats.system_memory?.total),
      uptimeSeconds: optionalNumber(stats.system_uptime),
    };
  }

  async listPowerDevices(): Promise<PowerDevice[]> {
    let result: { devices?: Record<string, unknown>[] };
    try {
      result = (await this.call("machine.device_power.devices")) as typeof result;
    } catch (error) {
      // Moonraker without a [power] section does not register these methods.
      if (error instanceof MoonrakerError && /not found|not registered/i.test(error.message))
        return [];
      throw error;
    }
    return (result.devices ?? []).map((device) => ({
      name: String(device.device),
      state: String(device.status ?? "unknown"),
      type: device.type ? String(device.type) : null,
      lockedWhilePrinting: device.locked_while_printing === true,
    }));
  }

  async setPowerDevice(name: string, on: boolean) {
    await this.call("machine.device_power.post_device", {
      device: name,
      action: on ? "on" : "off",
    });
  }

  async getBedMesh(): Promise<BedMesh | null> {
    const list = (await this.call("printer.objects.list")) as { objects?: string[] };
    if (!list.objects?.includes("bed_mesh")) return null;
    const result = (await this.call("printer.objects.query", { objects: { bed_mesh: null } })) as {
      status?: { bed_mesh?: MoonrakerBedMesh };
    };
    const mesh = result.status?.bed_mesh ?? {};
    return {
      activeProfile: mesh.profile_name || null,
      min: toPoint(mesh.mesh_min),
      max: toPoint(mesh.mesh_max),
      probed: toMatrix(mesh.probed_matrix),
      mesh: toMatrix(mesh.mesh_matrix),
      profiles: Object.entries(mesh.profiles ?? {})
        .map(([name, profile]) => {
          const params = profile.mesh_params ?? {};
          return {
            name,
            points: toMatrix(profile.points),
            min: toPoint([params.min_x, params.min_y]),
            max: toPoint([params.max_x, params.max_y]),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async bedMesh(action: BedMeshAction) {
    if ("profile" in action && !/^[A-Za-z0-9_-]{1,64}$/.test(action.profile))
      throw new MoonrakerError("Invalid profile name.");
    const homed = String(this.objects.toolhead?.homed_axes ?? "");
    const script = {
      calibrate: () =>
        `${["x", "y", "z"].every((axis) => homed.includes(axis)) ? "" : "G28\n"}BED_MESH_CALIBRATE`,
      clear: () => "BED_MESH_CLEAR",
      load: () => `BED_MESH_PROFILE LOAD=${"profile" in action ? action.profile : ""}`,
      // Profiles live in printer.cfg; SAVE_CONFIG writes them and restarts Klipper.
      save: () => `BED_MESH_PROFILE SAVE=${"profile" in action ? action.profile : ""}\nSAVE_CONFIG`,
      remove: () =>
        `BED_MESH_PROFILE REMOVE=${"profile" in action ? action.profile : ""}\nSAVE_CONFIG`,
    }[action.op]();
    await this.sendGcode(script);
  }

  private authHeaders(): Record<string, string> {
    return this.connection?.apiKey ? { "X-Api-Key": this.connection.apiKey } : {};
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
    // Moonraker answers when the G-code finished; homing, heating or a mesh calibration take minutes.
    await this.call("printer.gcode.script", { script }, GCODE_TIMEOUT_MS);
  }
  async setTemperature(heaterId: string, target: number) {
    if (!isControllable(heaterId)) throw new MoonrakerError(`"${heaterId}" is not a heater.`);
    await this.sendGcode(
      `SET_HEATER_TEMPERATURE HEATER=${heaterParam(heaterId)} TARGET=${Math.round(target * 10) / 10}`,
    );
  }

  async home(axes: Axis[]) {
    await this.sendGcode(`G28${axes.map((axis) => ` ${axis.toUpperCase()}`).join("")}`);
  }
  async jog(axis: Axis, distance: number) {
    const feed = axis === "z" ? JOG_FEED.z : JOG_FEED.xy;
    // Relative move, then back to absolute positioning (same sequence as Mainsail).
    await this.sendGcode(`G91\nG1 ${axis.toUpperCase()}${num(distance)} F${feed}\nG90`);
  }
  async motorsOff() {
    await this.sendGcode("M84");
  }
  async adjustZOffset(delta: number) {
    await this.sendGcode(`SET_GCODE_OFFSET Z_ADJUST=${num(delta)} MOVE=1`);
  }
  async setSpeedFactor(factor: number) {
    await this.sendGcode(`M220 S${Math.round(factor * 100)}`);
  }
  async setFlowFactor(factor: number) {
    await this.sendGcode(`M221 S${Math.round(factor * 100)}`);
  }
  async setFanSpeed(fanId: string, speed: number) {
    if (!this.fans.includes(fanId) || !isControllableFan(fanId))
      throw new MoonrakerError(`"${fanId}" is not a controllable fan.`);
    const clamped = Math.min(1, Math.max(0, speed));
    if (fanId === "fan") {
      await this.sendGcode(clamped === 0 ? "M107" : `M106 S${Math.round(clamped * 255)}`);
    } else if (fanId.startsWith("fan_generic ")) {
      await this.sendGcode(`SET_FAN_SPEED FAN=${fanDisplayName(fanId)} SPEED=${num(clamped)}`);
    } else {
      // SET_PIN takes the value in the pin's configured scale (Creality: scale 255).
      const scale = this.pinScales[fanId] ?? 1;
      await this.sendGcode(`SET_PIN PIN=${fanDisplayName(fanId)} VALUE=${num(clamped * scale)}`);
    }
  }
  async excludeObject(name: string) {
    if (!/^[^\s;"'\\]+$/.test(name)) throw new MoonrakerError("Invalid object name.");
    await this.sendGcode(`EXCLUDE_OBJECT NAME=${name}`);
  }

  async getTemperatureHistory(): Promise<TemperatureHistory> {
    const store = (await this.call("server.temperature_store", {
      include_monitors: false,
    })) as Record<string, { temperatures?: number[]; targets?: number[] }>;
    const series = sortHeaters(Object.keys(store).filter((name) => HEATER_PATTERN.test(name))).map(
      (id) => ({
        id,
        name: displayHeaterName(id),
        temperatures: store[id]?.temperatures ?? [],
        targets: store[id]?.targets ?? null,
      }),
    );
    return { intervalSeconds: 1, series };
  }

  async listWebcams(): Promise<Webcam[]> {
    const url = this.connection?.url;
    if (!url) throw new MoonrakerError("Not connected.");
    const result = (await this.call("server.webcams.list")) as {
      webcams?: Record<string, unknown>[];
    };
    return (result.webcams ?? [])
      .filter((cam) => cam.enabled !== false)
      .map((cam) => ({
        name: String(cam.name ?? "Webcam"),
        service: String(cam.service ?? "mjpegstreamer"),
        streamUrl: resolveWebcamUrl(url, cam.stream_url),
        snapshotUrl: resolveWebcamUrl(url, cam.snapshot_url),
        flipHorizontal: cam.flip_horizontal === true,
        flipVertical: cam.flip_vertical === true,
        rotation: Number(cam.rotation ?? 0) || 0,
      }));
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
    for (const heater of this.heaters) {
      objects[heater] = isControllable(heater)
        ? ["temperature", "target", "power"]
        : ["temperature", "target"];
    }
    this.fans = list.objects.filter((name) => FAN_PATTERN.test(name));
    for (const fan of this.fans) objects[fan] = fanFields(fan);
    this.pinScales = await this.readPinScales(
      this.fans.filter((fan) => fan.startsWith("output_pin ")),
    );
    for (const [name, fields] of Object.entries(OPTIONAL_OBJECTS)) {
      if (list.objects.includes(name)) objects[name] = fields;
    }
    const result = (await this.call("printer.objects.subscribe", { objects })) as {
      status: KlipperObjects;
    };
    mergeObjects(this.objects, result.status);
    this.publish();
  }

  /** `scale` of output pins from the printer config (default 1), needed to convert 0–1 to SET_PIN values. */
  private async readPinScales(pins: string[]): Promise<Record<string, number>> {
    if (pins.length === 0) return {};
    const result = (await this.call("printer.objects.query", {
      objects: { configfile: ["settings"] },
    }).catch(() => null)) as {
      status?: { configfile?: { settings?: Record<string, { scale?: number }> } };
    } | null;
    const settings = result?.status?.configfile?.settings ?? {};
    return Object.fromEntries(
      pins.map((pin) => [pin, Number(settings[pin.toLowerCase()]?.scale ?? 1) || 1]),
    );
  }

  private publish() {
    this.status = toPrinterStatus(this.objects, this.heaters, this.fans);
    for (const listener of this.statusListeners) listener(this.status);
  }

  private call(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new MoonrakerError("Not connected."));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new MoonrakerError(`Moonraker did not answer ${method}.`));
      }, timeoutMs);
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
