/**
 * Printer driver interface. Every printer ecosystem (Moonraker, PrusaLink,
 * Bambu Lab MQTT, OctoPrint, …) is integrated through one implementation of
 * this interface; nothing outside a driver knows ecosystem specifics.
 */

export type PrinterState = "offline" | "connecting" | "idle" | "printing" | "paused" | "error";

export interface TemperatureReading {
  /** Stable id used for commands, e.g. "extruder", "heater_bed", "heater_generic chamber". */
  id: string;
  /** Display name, e.g. "extruder", "heater_bed", "chamber", "mcu_temp". */
  name: string;
  current: number;
  target: number | null;
  /** True for heaters whose target can be set; false for passive sensors. */
  controllable: boolean;
  /** Heater duty cycle 0–1; null for sensors. */
  power: number | null;
}

export interface FanStatus {
  /** Stable id used for commands, e.g. "fan", "fan_generic aux", "output_pin fan0". */
  id: string;
  /** Display name, e.g. "fan", "aux", "fan0". */
  name: string;
  /** 0–1 */
  speed: number;
  /** False for automatic fans (heater_fan, controller_fan). */
  controllable: boolean;
}

export interface PrintFile {
  /** Path relative to the printer's G-code root, e.g. "parts/bracket.gcode". */
  path: string;
  size: number;
  modified: Date;
  /** Slicer metadata, when the printer provides it. */
  estimatedSeconds: number | null;
  filamentMm: number | null;
  filamentGrams: number | null;
  layerHeight: number | null;
  objectHeight: number | null;
  slicer: string | null;
  /** Largest thumbnail, relative to the printer's G-code root. */
  thumbnailPath: string | null;
}

export interface FileListing {
  directories: string[];
  files: PrintFile[];
}

export type JobStatus = "completed" | "cancelled" | "error" | "interrupted" | "in_progress";

export interface PrintJob {
  id: string;
  fileName: string;
  status: JobStatus;
  startedAt: Date;
  endedAt: Date | null;
  printSeconds: number;
  filamentMm: number;
  thumbnailPath: string | null;
}

export interface PrintTotals {
  jobs: number;
  printSeconds: number;
  filamentMm: number;
}

export interface TemperatureHistory {
  /** Seconds between samples. */
  intervalSeconds: number;
  /** Oldest sample first; `targets` is null for sensors. */
  series: { id: string; name: string; temperatures: number[]; targets: number[] | null }[];
}

export interface Webcam {
  name: string;
  /** e.g. "mjpegstreamer", "mjpegstreamer-adaptive", "webrtc-camerastreamer". */
  service: string;
  /** Absolute URLs, resolved against the printer host. */
  streamUrl: string | null;
  snapshotUrl: string | null;
  flipHorizontal: boolean;
  flipVertical: boolean;
  rotation: number;
}

export interface PrintProgress {
  fileName: string;
  /** 0–1 */
  progress: number;
  elapsedSeconds: number;
  remainingSeconds: number | null;
  /** Filament used by the current job so far, in millimetres. */
  filamentUsedMm: number;
}

export type Axis = "x" | "y" | "z";

export interface MotionStatus {
  /** G-code position (what the user commanded), in mm. */
  position: Record<Axis, number>;
  homedAxes: Axis[];
  /** Axis limits from the printer config, when known. */
  min: Record<Axis, number> | null;
  max: Record<Axis, number> | null;
  /** Current Z offset (babystepping), mm. */
  zOffset: number;
  /** 1 = 100 %. */
  speedFactor: number;
  flowFactor: number;
}

export interface ObjectExclusion {
  objects: string[];
  excluded: string[];
  current: string | null;
}

export interface PrinterStatus {
  state: PrinterState;
  message: string | null;
  temperatures: TemperatureReading[];
  job: PrintProgress | null;
  /** Null until known (e.g. while Klipper is starting). */
  motion: MotionStatus | null;
  fans: FanStatus[];
  /** Objects of the current print that can be skipped (Klipper exclude_object); null when unsupported. */
  exclusion: ObjectExclusion | null;
  updatedAt: Date;
}

export interface ConsoleEntry {
  time: Date;
  kind: "command" | "response";
  message: string;
}

export interface MacroParam {
  name: string;
  /** Default from the macro template (`params.X|default(...)`), as written. */
  defaultValue: string | null;
}

export interface Macro {
  /** Command name as configured, e.g. "PRINT_START". */
  name: string;
  description: string | null;
  params: MacroParam[];
}

export interface GcodeCommand {
  name: string;
  description: string | null;
}

export interface ConfigFile {
  /** Relative to the config root, e.g. "printer.cfg" or "includes/macros.cfg". */
  path: string;
  size: number;
  modified: Date;
}

export interface HostService {
  name: string;
  /** systemd state, e.g. "active", "inactive", "failed"; null when unknown. */
  state: string | null;
}

export interface LogFile {
  name: string;
  size: number;
  modified: Date;
}

export interface SystemInfo {
  hostname: string | null;
  os: string | null;
  kernel: string | null;
  cpu: string | null;
  cpuCores: number | null;
  /** Bytes. */
  memoryTotal: number | null;
  python: string | null;
  firmwareVersion: string | null;
  hostSoftwareVersion: string | null;
  network: { name: string; addresses: string[] }[];
}

export interface SystemStats {
  /** Percent, 0–100. */
  cpuUsage: number | null;
  cpuTemp: number | null;
  /** Bytes. */
  memoryUsed: number | null;
  memoryTotal: number | null;
  uptimeSeconds: number | null;
}

export interface PowerDevice {
  name: string;
  /** "on", "off", or another state the host reports (e.g. "init", "error"). */
  state: string;
  type: string | null;
  /** The host refuses to switch it while a print is running. */
  lockedWhilePrinting: boolean;
}

export interface BedMeshProfile {
  name: string;
  /** Probed heights, rows from min Y to max Y, each from min X to max X (mm). */
  points: number[][];
  min: [number, number] | null;
  max: [number, number] | null;
}

export interface BedMesh {
  /** Loaded profile; null when no mesh is active. */
  activeProfile: string | null;
  min: [number, number] | null;
  max: [number, number] | null;
  /** Active mesh as probed and as interpolated by the firmware (same row order as profiles). */
  probed: number[][];
  mesh: number[][];
  profiles: BedMeshProfile[];
}

export type BedMeshAction =
  | { op: "calibrate" }
  | { op: "clear" }
  | { op: "load"; profile: string }
  | { op: "save"; profile: string }
  | { op: "remove"; profile: string };

export interface SoftwareCommit {
  sha: string;
  subject: string;
  author: string | null;
  date: Date | null;
}

/** One updatable piece of the printer host: OS packages, firmware host, web UI, … */
export interface SoftwareComponent {
  name: string;
  kind: "system" | "git" | "web" | "other";
  version: string | null;
  remoteVersion: string | null;
  updateAvailable: boolean;
  /** Commits between the installed and the remote version (git repos). */
  commitsBehind: SoftwareCommit[];
  /** Pending OS packages (kind "system"). */
  packages: string[];
  /** Local changes or a broken checkout; needs a recovery before updating. */
  needsRecovery: boolean;
  warnings: string[];
}

export interface UpdateStatus {
  /** An update is running on the host. */
  busy: boolean;
  components: SoftwareComponent[];
}

export type UpdateAction =
  | { op: "refresh"; name?: string }
  | { op: "upgrade"; name?: string }
  | { op: "recover"; name: string };

export interface UpdateProgress {
  application: string;
  message: string;
  complete: boolean;
}

export type HostAction = "reboot" | "shutdown";

/**
 * A file that can be streamed from disk, e.g. a Blob from `fs.openAsBlob`
 * (declared structurally so the SDK does not depend on DOM or Node types).
 */
export interface FileBlob {
  readonly size: number;
  readonly type: string;
}

export interface PrinterConnection {
  /** Base URL of the printer API, e.g. "http://voron.local:7125". */
  url: string;
  apiKey?: string;
}

export interface PrinterInfo {
  hostname: string | null;
  /** Firmware/host state as reported by the printer, e.g. Klipper's "ready". */
  firmwareState: string | null;
}

export interface PrinterDriver {
  /** Stable driver id, e.g. "moonraker". */
  readonly id: string;
  /** Resolves once connected and the first status is known; rejects if the printer is unreachable. */
  connect(connection: PrinterConnection): Promise<void>;
  disconnect(): Promise<void>;
  getInfo(): Promise<PrinterInfo>;
  getStatus(): Promise<PrinterStatus>;
  onStatus(listener: (status: PrinterStatus) => void): () => void;
  /** Console output (G-code responses), if the ecosystem provides it. */
  onConsole(listener: (line: string) => void): () => void;
  /** Fired once when an established connection drops; the host decides when to reconnect. */
  onDisconnect(listener: () => void): () => void;

  /** Uploads into the G-code root; `path` may include sub-directories. */
  uploadFile(path: string, data: AsyncIterable<Uint8Array> | FileBlob): Promise<void>;
  startPrint(path: string): Promise<void>;
  /** `directory` is relative to the G-code root ("" = root). */
  listFiles(directory: string): Promise<FileListing>;
  deleteFile(path: string): Promise<void>;
  /** Raw bytes of a file under the G-code root (used for thumbnails). */
  readFile(path: string): Promise<{ contentType: string; body: AsyncIterable<Uint8Array> }>;
  listJobs(limit: number, offset: number): Promise<{ jobs: PrintJob[]; totals: PrintTotals }>;
  /** Recent console traffic, oldest first. */
  getConsoleHistory(count: number): Promise<ConsoleEntry[]>;
  /** User macros, including hidden ones (names starting with "_"). */
  listMacros(): Promise<Macro[]>;
  /** Commands the firmware knows, for autocomplete. */
  listGcodeCommands(): Promise<GcodeCommand[]>;
  listConfigFiles(): Promise<ConfigFile[]>;
  readConfigFile(path: string): Promise<string>;
  writeConfigFile(path: string, content: string): Promise<void>;
  /** Restarts the firmware host software; `firmware` also resets the MCUs (Klipper FIRMWARE_RESTART). */
  restartFirmware(firmware: boolean): Promise<void>;
  listServices(): Promise<HostService[]>;
  restartService(name: string): Promise<void>;
  hostPower(action: HostAction): Promise<void>;
  listLogs(): Promise<LogFile[]>;
  /** Raw log contents; `fromEnd` limits it to roughly the last N bytes when the host supports ranges. */
  readLog(
    name: string,
    fromEnd?: number,
  ): Promise<{ partial: boolean; body: AsyncIterable<Uint8Array> }>;
  getSystemInfo(): Promise<SystemInfo>;
  getSystemStats(): Promise<SystemStats>;
  /** Switchable power outlets/relays; empty when the host has none configured. */
  listPowerDevices(): Promise<PowerDevice[]>;
  setPowerDevice(name: string, on: boolean): Promise<void>;
  /** Null when the printer has no bed mesh support configured. */
  getBedMesh(): Promise<BedMesh | null>;
  /** Saving or removing a profile persists it in the printer config, which restarts the firmware. */
  bedMesh(action: BedMeshAction): Promise<void>;
  getUpdateStatus(): Promise<UpdateStatus>;
  /** Long-running; progress arrives through `onUpdateProgress`. Without `name`, applies to everything. */
  updateSoftware(action: UpdateAction): Promise<void>;
  onUpdateProgress(listener: (progress: UpdateProgress) => void): () => void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  emergencyStop(): Promise<void>;
  sendGcode(script: string): Promise<void>;
  setTemperature(heaterId: string, target: number): Promise<void>;
  /** Homes the given axes; an empty list homes all. */
  home(axes: Axis[]): Promise<void>;
  /** Relative move of one axis in mm. */
  jog(axis: Axis, distance: number): Promise<void>;
  motorsOff(): Promise<void>;
  /** Babystep: adds `delta` mm to the Z offset. */
  adjustZOffset(delta: number): Promise<void>;
  /** Factors: 1 = 100 %. */
  setSpeedFactor(factor: number): Promise<void>;
  setFlowFactor(factor: number): Promise<void>;
  /** 0–1; only for fans reported as controllable. */
  setFanSpeed(fanId: string, speed: number): Promise<void>;
  excludeObject(name: string): Promise<void>;
  getTemperatureHistory(): Promise<TemperatureHistory>;
  listWebcams(): Promise<Webcam[]>;
}

export interface PrinterDriverFactory {
  readonly id: string;
  readonly displayName: string;
  create(): PrinterDriver;
}
