import { z } from "zod";
import { httpUrlSchema } from "./printers.ts";

/** Common materials; free text is allowed too (e.g. "PA-CF"). */
export const MATERIALS = ["PLA", "PETG", "ABS", "ASA", "TPU", "PA", "PC", "PVA", "HIPS"] as const;

/** Typical densities in g/cm³, used when a filament has none. */
export const MATERIAL_DENSITY: Record<string, number> = {
  PLA: 1.24,
  PETG: 1.27,
  ABS: 1.04,
  ASA: 1.07,
  TPU: 1.21,
  PA: 1.14,
  PC: 1.2,
  PVA: 1.23,
  HIPS: 1.04,
};

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #ff6600.")
  .transform((value) => value.toLowerCase());
const grams = z.number().min(0).max(100_000);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable();

export const filamentSchema = z.object({
  id: z.uuid(),
  vendor: z.string().nullable(),
  name: z.string(),
  material: z.string(),
  colorName: z.string().nullable(),
  colorHex: z.string().nullable(),
  diameter: z.number(),
  density: z.number(),
  /** Net weight of a full spool in g, used as the default for new spools. */
  spoolWeight: z.number().nullable(),
  /** Weight of the empty spool in g, to weigh spools on a scale. */
  emptySpoolWeight: z.number().nullable(),
  /** Price of a full spool, used as the default for new spools. */
  price: z.number().nullable(),
  spoolCount: z.number(),
});
export type FilamentDto = z.infer<typeof filamentSchema>;

export const filamentInputSchema = z.object({
  vendor: optionalText(80),
  name: z.string().trim().min(1, "Enter a name.").max(80),
  material: z.string().trim().min(1, "Enter a material.").max(32),
  colorName: optionalText(40),
  colorHex: hexColor.nullable(),
  diameter: z.number().min(1).max(3.5).default(1.75),
  density: z.number().min(0.5).max(3).nullable().optional(),
  spoolWeight: grams.nullable().optional(),
  emptySpoolWeight: grams.nullable().optional(),
  price: z.number().min(0).max(100_000).nullable().optional(),
});
export type FilamentInput = z.infer<typeof filamentInputSchema>;

export const spoolSchema = z.object({
  id: z.uuid(),
  filamentId: z.uuid(),
  /** Net filament weight when the spool was new, g. */
  initialWeight: z.number(),
  remainingWeight: z.number(),
  emptySpoolWeight: z.number().nullable(),
  price: z.number().nullable(),
  location: z.string().nullable(),
  lot: z.string().nullable(),
  notes: z.string().nullable(),
  archived: z.boolean(),
  /** Printers this spool is loaded in. */
  printerIds: z.array(z.uuid()),
  createdAt: z.iso.datetime(),
});
export type SpoolDto = z.infer<typeof spoolSchema>;

export const spoolInputSchema = z.object({
  filamentId: z.uuid(),
  initialWeight: grams.positive("Enter the filament weight."),
  remainingWeight: grams.optional(),
  emptySpoolWeight: grams.nullable().optional(),
  price: z.number().min(0).max(100_000).nullable().optional(),
  location: optionalText(80).optional(),
  lot: optionalText(80).optional(),
  notes: optionalText(500).optional(),
});
export type SpoolInput = z.infer<typeof spoolInputSchema>;

export const spoolUpdateSchema = spoolInputSchema.omit({ filamentId: true }).partial().extend({
  archived: z.boolean().optional(),
  /** Gross weight on a scale; remaining = gross − empty spool weight. */
  measuredGrossWeight: grams.optional(),
});
export type SpoolUpdate = z.infer<typeof spoolUpdateSchema>;

export const inventorySchema = z.object({
  filaments: z.array(filamentSchema),
  spools: z.array(spoolSchema),
});
export type InventoryDto = z.infer<typeof inventorySchema>;

export const activeSpoolSchema = z.object({ spoolId: z.uuid().nullable() });

export const spoolmanImportSchema = z.object({ url: httpUrlSchema });
export const spoolmanImportResultSchema = z.object({
  filaments: z.number(),
  spoolsCreated: z.number(),
  spoolsUpdated: z.number(),
});
export type SpoolmanImportResult = z.infer<typeof spoolmanImportResultSchema>;

/**
 * Low stock: an active (not archived) spool with less filament left than the
 * threshold in grams. Absolute grams because what matters is whether the next
 * print fits, whatever the spool held when new. A threshold of 0 turns it off;
 * an empty spool (0 g) is low.
 */
export function isLowStock(
  spool: Pick<SpoolDto, "remainingWeight" | "archived">,
  thresholdGrams: number,
) {
  return !spool.archived && thresholdGrams > 0 && spool.remainingWeight < thresholdGrams;
}
