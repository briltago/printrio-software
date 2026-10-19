/**
 * Printer driver interface. Every printer ecosystem (Moonraker, PrusaLink,
 * Bambu Lab MQTT, OctoPrint, …) is integrated through one implementation of
 * this interface; nothing outside a driver knows ecosystem specifics.
 */

export type PrinterState = "offline" | "connecting" | "idle" | "printing" | "paused" | "error";

export interface TemperatureReading {
  /** Heater or sensor name, e.g. "extruder", "heater_bed", "chamber". */
  name: string;
  current: number;
  target: number | null;
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

export interface PrinterStatus {
  state: PrinterState;
  message: string | null;
  temperatures: TemperatureReading[];
  job: PrintProgress | null;
  updatedAt: Date;
}

export interface PrinterConnection {
  /** Base URL of the printer API, e.g. "http://voron.local:7125". */
  url: string;
  apiKey?: string;
}

export interface PrinterDriver {
  /** Stable driver id, e.g. "moonraker". */
  readonly id: string;
  connect(connection: PrinterConnection): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): Promise<PrinterStatus>;
  onStatus(listener: (status: PrinterStatus) => void): () => void;

  uploadFile(name: string, data: AsyncIterable<Uint8Array>): Promise<void>;
  startPrint(fileName: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  sendGcode(script: string): Promise<void>;
}

export interface PrinterDriverFactory {
  readonly id: string;
  readonly displayName: string;
  create(): PrinterDriver;
}
