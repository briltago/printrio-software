import type { JobRecordDto, PrinterStatusDto, RecordedJobStatus } from "@printrio/shared";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { filaments, printers, printJobs, spools } from "../db/schema.ts";
import type { PrinterManager } from "../printers/manager.ts";
import { toJobRecord } from "../routes/jobs.ts";
import { getWorkspaceSettings } from "../settings.ts";
import { computeJobCost } from "./cost.ts";

const ACTIVE = new Set(["printing", "paused"]);
/** Running jobs are saved at most this often (progress survives a server restart). */
const SAVE_INTERVAL_MS = 30_000;

export type JobEvent = "job.started" | "job.finished";

interface OpenJob {
  id: string;
  fileName: string;
  printSeconds: number;
  filamentMm: number;
  savedAt: number;
}

/**
 * Records every print in Printrio's database. A job opens when a printer starts
 * printing and closes when it stops; the final status, duration and filament
 * come from the printer's own history when available. The cost (material of
 * the spool loaded at the start + energy) is stored when the job closes.
 */
export class JobRecorder {
  private open = new Map<string, OpenJob>();
  /** Order to link to the next job of a printer (set when a queued print starts). */
  private expectedOrders = new Map<string, { fileName: string; orderId: string }>();
  private queues = new Map<string, Promise<void>>();
  private listener = (printerId: string, status: PrinterStatusDto) =>
    this.enqueue(printerId, () => this.onStatus(printerId, status));

  constructor(
    private db: Database,
    private manager: PrinterManager,
    private onChange: () => void = () => {},
    /** Job lifecycle for modules (e.g. spool consumption, notifications). */
    private onJob: (event: JobEvent, job: JobRecordDto) => void = () => {},
  ) {}

  async start() {
    const rows = await this.db.select().from(printJobs).where(eq(printJobs.status, "printing"));
    for (const row of rows) {
      if (!row.printerId) continue;
      this.open.set(row.printerId, {
        id: row.id,
        fileName: row.fileName,
        printSeconds: row.printSeconds,
        filamentMm: row.filamentMm,
        savedAt: Date.now(),
      });
    }
    this.manager.on("status", this.listener);
  }

  stop() {
    this.manager.off("status", this.listener);
  }

  /** The next job of `printerId` printing `fileName` belongs to `orderId`. */
  expectOrder(printerId: string, fileName: string, orderId: string | null) {
    if (orderId) this.expectedOrders.set(printerId, { fileName, orderId });
    else this.expectedOrders.delete(printerId);
  }

  /** Resolves once all queued status updates are processed (for tests). */
  async idle() {
    await Promise.all(this.queues.values());
  }

  /** Status updates of one printer are handled in order, one at a time. */
  private enqueue(printerId: string, task: () => Promise<void>) {
    const previous = this.queues.get(printerId) ?? Promise.resolve();
    const next = previous.then(task).catch((error) => {
      console.error(`Job recorder (${printerId}):`, error);
    });
    this.queues.set(printerId, next);
  }

  private async onStatus(printerId: string, status: PrinterStatusDto) {
    const open = this.open.get(printerId);
    const job = status.job;
    if (ACTIVE.has(status.state) && job) {
      if (open && open.fileName !== job.fileName) await this.close(printerId, open);
      const current = this.open.get(printerId);
      if (!current) {
        await this.create(printerId, job.fileName, job.elapsedSeconds, job.filamentUsedMm);
        return;
      }
      current.printSeconds = job.elapsedSeconds;
      current.filamentMm = job.filamentUsedMm;
      if (Date.now() - current.savedAt > SAVE_INTERVAL_MS) {
        current.savedAt = Date.now();
        await this.db
          .update(printJobs)
          .set({ printSeconds: current.printSeconds, filamentMm: current.filamentMm })
          .where(eq(printJobs.id, current.id));
      }
      return;
    }
    // Offline or (re)connecting says nothing about the print; wait for a real state.
    if (open && (status.state === "idle" || status.state === "error")) {
      await this.close(printerId, open, status.state === "error" ? "error" : null);
    }
  }

  private async create(printerId: string, fileName: string, elapsed: number, filamentMm: number) {
    const [printer] = await this.db.select().from(printers).where(eq(printers.id, printerId));
    if (!printer) return;
    const settings = await getWorkspaceSettings(this.db);
    const spool = printer.activeSpoolId
      ? (
          await this.db
            .select({ spool: spools, filament: filaments })
            .from(spools)
            .innerJoin(filaments, eq(filaments.id, spools.filamentId))
            .where(eq(spools.id, printer.activeSpoolId))
        )[0]
      : undefined;
    const expected = this.expectedOrders.get(printerId);
    this.expectedOrders.delete(printerId);
    const orderId = expected?.fileName === fileName ? expected.orderId : null;
    const label = spool
      ? [spool.filament.vendor, spool.filament.name, spool.filament.colorName]
          .filter(Boolean)
          .join(" ")
      : null;
    const [row] = await this.db
      .insert(printJobs)
      .values({
        printerId,
        printerName: printer.name,
        fileName,
        status: "printing",
        startedAt: new Date(Date.now() - elapsed * 1000),
        printSeconds: elapsed,
        filamentMm,
        spoolId: spool?.spool.id ?? null,
        spoolLabel: label,
        spoolColorHex: spool?.filament.colorHex ?? null,
        material: spool?.filament.material ?? null,
        currency: settings.costs.currency,
        orderId,
      })
      .returning();
    if (!row) return;
    this.open.set(printerId, {
      id: row.id,
      fileName,
      printSeconds: elapsed,
      filamentMm,
      savedAt: Date.now(),
    });
    this.onChange();
    this.onJob("job.started", toJobRecord(row));
  }

  private async close(printerId: string, open: OpenJob, fallback: RecordedJobStatus | null = null) {
    this.open.delete(printerId);
    let status: RecordedJobStatus = fallback ?? "interrupted";
    let printSeconds = open.printSeconds;
    let filamentMm = open.filamentMm;
    // The printer's history knows how the job really ended (completed vs cancelled).
    try {
      const { jobs } = await this.manager.connected(printerId).listJobs(1, 0);
      const latest = jobs[0];
      if (latest && latest.fileName === open.fileName && latest.status !== "in_progress") {
        status = latest.status === "interrupted" ? "interrupted" : latest.status;
        printSeconds = latest.printSeconds || printSeconds;
        filamentMm = latest.filamentMm || filamentMm;
      }
    } catch {
      // History unavailable: keep what live status reported.
    }

    const [row] = await this.db.select().from(printJobs).where(eq(printJobs.id, open.id));
    if (!row) return;
    const [printer] = await this.db.select().from(printers).where(eq(printers.id, printerId));
    const settings = await getWorkspaceSettings(this.db);
    const spool = row.spoolId
      ? (
          await this.db
            .select({ spool: spools, filament: filaments })
            .from(spools)
            .innerJoin(filaments, eq(filaments.id, spools.filamentId))
            .where(eq(spools.id, row.spoolId))
        )[0]
      : undefined;
    const cost = computeJobCost({
      filamentMm,
      printSeconds,
      filament: spool
        ? { diameter: spool.filament.diameter, density: spool.filament.density }
        : null,
      spool: spool ? { price: spool.spool.price, initialWeight: spool.spool.initialWeight } : null,
      powerWatts: printer?.powerWatts ?? settings.costs.defaultPowerWatts,
      electricityPrice: settings.costs.electricityPrice,
    });
    const [closed] = await this.db
      .update(printJobs)
      .set({
        status,
        endedAt: new Date(),
        printSeconds,
        filamentMm,
        ...cost,
        currency: settings.costs.currency,
      })
      .where(and(eq(printJobs.id, open.id), eq(printJobs.status, "printing")))
      .returning();
    this.onChange();
    if (closed) this.onJob("job.finished", toJobRecord(closed));
  }
}
