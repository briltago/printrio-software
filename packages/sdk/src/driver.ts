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
  /** Part cooling fan, 0–1; null when the printer has no fan object. */
  fanSpeed: number | null;
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
  /** Objects of the current print that can be skipped (Klipper exclude_object); null when unsupported. */
  exclusion: ObjectExclusion | null;
  updatedAt: Date;
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

  uploadFile(name: string, data: AsyncIterable<Uint8Array>): Promise<void>;
  startPrint(fileName: string): Promise<void>;
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
  /** 0–1 */
  setFanSpeed(speed: number): Promise<void>;
  excludeObject(name: string): Promise<void>;
  getTemperatureHistory(): Promise<TemperatureHistory>;
  listWebcams(): Promise<Webcam[]>;
}

export interface PrinterDriverFactory {
  readonly id: string;
  readonly displayName: string;
  create(): PrinterDriver;
}
