import { EventEmitter } from "node:events";
import type {
  PrinterConnection,
  PrinterDriver,
  PrinterDriverFactory,
  PrinterStatus,
} from "@printrio/sdk";
import type { PrinterCommand, PrinterStatusDto } from "@printrio/shared";

const MAX_BACKOFF_MS = 30_000;

interface Entry {
  connection: PrinterConnection;
  driver: PrinterDriver | null;
  status: PrinterStatus;
  attempt: number;
  retry: ReturnType<typeof setTimeout> | null;
  /** Bumped on every (re)configuration so stale connection attempts are ignored. */
  generation: number;
}

export interface PrinterManagerEvents {
  status: [printerId: string, status: PrinterStatusDto];
  console: [printerId: string, line: string];
}

export class PrinterNotConnectedError extends Error {}

export const toStatusDto = (status: PrinterStatus): PrinterStatusDto => ({
  ...status,
  updatedAt: status.updatedAt.toISOString(),
});

const offline = (message: string | null = null): PrinterStatus => ({
  state: "offline",
  message,
  temperatures: [],
  job: null,
  updatedAt: new Date(),
});

/**
 * Keeps one driver connection per configured printer, reconnects with
 * exponential backoff and re-emits status/console events for the realtime hub.
 */
export class PrinterManager extends EventEmitter<PrinterManagerEvents> {
  private entries = new Map<string, Entry>();
  private stopped = false;

  constructor(
    private factories: Map<string, PrinterDriverFactory>,
    private initialBackoffMs = 1000,
  ) {
    super();
  }

  /** Adds or reconfigures a printer and (re)connects it. */
  upsert(id: string, driverId: string, connection: PrinterConnection) {
    const existing = this.entries.get(id);
    if (existing) this.teardown(existing);
    const entry: Entry = {
      connection,
      driver: null,
      status: { ...offline(), state: "connecting" },
      attempt: 0,
      retry: null,
      generation: (existing?.generation ?? 0) + 1,
    };
    this.entries.set(id, entry);
    this.setStatus(id, entry, entry.status);
    void this.connect(id, driverId, entry);
  }

  remove(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.teardown(entry);
    this.entries.delete(id);
  }

  getStatus(id: string): PrinterStatusDto {
    return toStatusDto(this.entries.get(id)?.status ?? offline());
  }

  snapshot(): Record<string, PrinterStatusDto> {
    return Object.fromEntries(
      [...this.entries].map(([id, entry]) => [id, toStatusDto(entry.status)]),
    );
  }

  async command(id: string, command: PrinterCommand) {
    const driver = this.entries.get(id)?.driver;
    if (!driver) throw new PrinterNotConnectedError("The printer is not connected.");
    switch (command.action) {
      case "pause":
        return driver.pause();
      case "resume":
        return driver.resume();
      case "cancel":
        return driver.cancel();
      case "emergency_stop":
        return driver.emergencyStop();
      case "gcode":
        return driver.sendGcode(command.script);
      case "set_temperature":
        return driver.setTemperature(command.heater, command.target);
    }
  }

  /** The connected driver, for read-only queries (history, webcams). */
  connected(id: string) {
    const driver = this.entries.get(id)?.driver;
    if (!driver) throw new PrinterNotConnectedError("The printer is not connected.");
    return driver;
  }

  async stop() {
    this.stopped = true;
    await Promise.all([...this.entries.values()].map((entry) => this.teardown(entry)));
    this.entries.clear();
  }

  private async connect(id: string, driverId: string, entry: Entry) {
    const factory = this.factories.get(driverId);
    if (!factory) {
      this.setStatus(id, entry, offline(`Unknown printer driver "${driverId}".`));
      return;
    }
    const generation = entry.generation;
    const driver = factory.create();
    try {
      await driver.connect(entry.connection);
    } catch (error) {
      await driver.disconnect().catch(() => {});
      if (this.isStale(id, generation)) return;
      this.setStatus(
        id,
        entry,
        offline(error instanceof Error ? error.message : "Connection failed."),
      );
      this.scheduleRetry(id, driverId, entry);
      return;
    }
    if (this.isStale(id, generation)) {
      await driver.disconnect();
      return;
    }
    entry.driver = driver;
    entry.attempt = 0;
    driver.onStatus((status) => this.setStatus(id, entry, status));
    driver.onConsole((line) => this.emit("console", id, line));
    driver.onDisconnect(() => {
      if (this.isStale(id, generation)) return;
      entry.driver = null;
      this.scheduleRetry(id, driverId, entry);
    });
    this.setStatus(id, entry, await driver.getStatus());
  }

  private scheduleRetry(id: string, driverId: string, entry: Entry) {
    if (this.stopped) return;
    const delay = Math.min(MAX_BACKOFF_MS, this.initialBackoffMs * 2 ** entry.attempt);
    entry.attempt++;
    entry.retry = setTimeout(() => {
      entry.retry = null;
      void this.connect(id, driverId, entry);
    }, delay);
  }

  private isStale(id: string, generation: number) {
    return this.stopped || this.entries.get(id)?.generation !== generation;
  }

  private setStatus(id: string, entry: Entry, status: PrinterStatus) {
    entry.status = status;
    this.emit("status", id, toStatusDto(status));
  }

  private async teardown(entry: Entry) {
    entry.generation++;
    if (entry.retry) clearTimeout(entry.retry);
    entry.retry = null;
    const driver = entry.driver;
    entry.driver = null;
    await driver?.disconnect().catch(() => {});
  }
}
