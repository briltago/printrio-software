import {
  type CostSummaryDto,
  type CostTotals,
  costSummaryQuerySchema,
  type JobListDto,
  type JobRecordDto,
  jobListQuerySchema,
} from "@printrio/shared";
import { and, count, desc, eq, gte, isNull, lt, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Database } from "../db/client.ts";
import { printJobs } from "../db/schema.ts";
import { getWorkspaceSettings } from "../settings.ts";
import { parseOr400, requireUser } from "./guards.ts";

type JobRow = typeof printJobs.$inferSelect;

export function toJobRecord(row: JobRow): JobRecordDto {
  return {
    id: row.id,
    printerId: row.printerId,
    printerName: row.printerName,
    fileName: row.fileName,
    status: row.status as JobRecordDto["status"],
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    printSeconds: row.printSeconds,
    filamentMm: row.filamentMm,
    filamentGrams: row.filamentGrams,
    spool: row.spoolLabel
      ? {
          id: row.spoolId,
          label: row.spoolLabel,
          colorHex: row.spoolColorHex,
          material: row.material ?? "",
        }
      : null,
    materialCost: row.materialCost,
    energyKwh: row.energyKwh,
    energyCost: row.energyCost,
    totalCost: row.totalCost,
    currency: row.currency,
    orderId: row.orderId,
  };
}

const emptyTotals = (): CostTotals => ({
  jobs: 0,
  printSeconds: 0,
  filamentGrams: 0,
  materialCost: 0,
  energyCost: 0,
  totalCost: 0,
});

function add(totals: CostTotals, row: JobRow) {
  totals.jobs += 1;
  totals.printSeconds += row.printSeconds;
  totals.filamentGrams += row.filamentGrams ?? 0;
  totals.materialCost += row.materialCost ?? 0;
  totals.energyCost += row.energyCost ?? 0;
  totals.totalCost += row.totalCost ?? 0;
}

/** Recorded print jobs and the cost overview (Free: material + energy, no prices or margins). */
export function jobRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/jobs", { preHandler: requireUser }, async (request, reply) => {
    const query = parseOr400(reply, jobListQuerySchema.safeParse(request.query));
    if (!query) return;
    const filters: SQL[] = [];
    if (query.printerId) filters.push(eq(printJobs.printerId, query.printerId));
    if (query.status) filters.push(eq(printJobs.status, query.status));
    if (query.orderId === "none") filters.push(isNull(printJobs.orderId));
    else if (query.orderId) filters.push(eq(printJobs.orderId, query.orderId));
    const where = filters.length ? and(...filters) : undefined;
    const [rows, [total]] = await Promise.all([
      db
        .select()
        .from(printJobs)
        .where(where)
        .orderBy(desc(printJobs.startedAt))
        .limit(query.limit)
        .offset(query.offset),
      db.select({ total: count() }).from(printJobs).where(where),
    ]);
    const body: JobListDto = { jobs: rows.map(toJobRecord), total: total?.total ?? 0 };
    return body;
  });

  app.get("/api/costs", { preHandler: requireUser }, async (request, reply) => {
    const query = parseOr400(reply, costSummaryQuerySchema.safeParse(request.query));
    if (!query) return;
    const filters: SQL[] = [];
    if (query.from) filters.push(gte(printJobs.startedAt, new Date(query.from)));
    if (query.to) filters.push(lt(printJobs.startedAt, new Date(query.to)));
    const rows = (
      await db
        .select()
        .from(printJobs)
        .where(filters.length ? and(...filters) : undefined)
    ).filter((row) => row.status !== "printing");
    const settings = await getWorkspaceSettings(db);

    const totals = emptyTotals();
    const byPrinter = new Map<string, CostSummaryDto["byPrinter"][number]>();
    const byMaterial = new Map<string, CostSummaryDto["byMaterial"][number]>();
    let jobsWithoutSpool = 0;
    for (const row of rows) {
      add(totals, row);
      const printerKey = row.printerId ?? `deleted:${row.printerName}`;
      const printer =
        byPrinter.get(printerKey) ??
        byPrinter
          .set(printerKey, {
            ...emptyTotals(),
            printerId: row.printerId,
            printerName: row.printerName,
          })
          .get(printerKey);
      if (printer) add(printer, row);
      if (row.material) {
        const material =
          byMaterial.get(row.material) ??
          byMaterial
            .set(row.material, { ...emptyTotals(), material: row.material })
            .get(row.material);
        if (material) add(material, row);
      } else jobsWithoutSpool += 1;
    }
    const byCost = (a: CostTotals, b: CostTotals) => b.totalCost - a.totalCost;
    const body: CostSummaryDto = {
      currency: settings.costs.currency,
      totals,
      byPrinter: [...byPrinter.values()].sort(byCost),
      byMaterial: [...byMaterial.values()].sort(byCost),
      jobsWithoutSpool,
    };
    return body;
  });
}
