import { z } from "zod";

export const recordedJobStatusSchema = z.enum([
  "printing",
  "completed",
  "cancelled",
  "error",
  "interrupted",
]);
export type RecordedJobStatus = z.infer<typeof recordedJobStatusSchema>;

/** A print recorded by Printrio, with its cost (material + energy) when it ended. */
export const jobRecordSchema = z.object({
  id: z.uuid(),
  printerId: z.uuid().nullable(),
  printerName: z.string(),
  fileName: z.string(),
  status: recordedJobStatusSchema,
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  printSeconds: z.number(),
  filamentMm: z.number(),
  filamentGrams: z.number().nullable(),
  spool: z
    .object({
      id: z.uuid().nullable(),
      label: z.string(),
      colorHex: z.string().nullable(),
      material: z.string(),
    })
    .nullable(),
  materialCost: z.number().nullable(),
  energyKwh: z.number().nullable(),
  energyCost: z.number().nullable(),
  totalCost: z.number().nullable(),
  currency: z.string(),
});
export type JobRecordDto = z.infer<typeof jobRecordSchema>;

export const jobListQuerySchema = z.object({
  printerId: z.uuid().optional(),
  status: recordedJobStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const jobListSchema = z.object({ jobs: z.array(jobRecordSchema), total: z.number() });
export type JobListDto = z.infer<typeof jobListSchema>;

const costTotals = z.object({
  jobs: z.number(),
  printSeconds: z.number(),
  filamentGrams: z.number(),
  materialCost: z.number(),
  energyCost: z.number(),
  totalCost: z.number(),
});
export type CostTotals = z.infer<typeof costTotals>;

export const costSummaryQuerySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export const costSummarySchema = z.object({
  currency: z.string(),
  totals: costTotals,
  byPrinter: z.array(
    costTotals.extend({ printerId: z.uuid().nullable(), printerName: z.string() }),
  ),
  byMaterial: z.array(costTotals.extend({ material: z.string() })),
  /** Jobs without a spool have no material cost. */
  jobsWithoutSpool: z.number(),
});
export type CostSummaryDto = z.infer<typeof costSummarySchema>;
