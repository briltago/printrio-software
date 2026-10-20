import { z } from "zod";
import { jobRecordSchema } from "./jobs.ts";
import { libraryFileSchema } from "./library.ts";

export const ORDER_STATUSES = ["new", "in_progress", "done", "cancelled"] as const;
export const orderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

/** Free edition order: a named list of prints for someone. Prices, deadlines and line items are Pro. */
export const orderSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  customer: z.string().nullable(),
  status: orderStatusSchema,
  notes: z.string().nullable(),
  /** Folder in Files (the library) holding this order's files; null = none. */
  folder: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  jobCount: z.number(),
  /** Sum of the recorded costs (material + energy) of the linked prints. */
  totalCost: z.number(),
  currency: z.string(),
});
export type OrderDto = z.infer<typeof orderSchema>;

export const orderInputSchema = z.object({
  /** Folder for the order's files instead of the workspace template (new orders only). */
  folder: z
    .string()
    .trim()
    .max(400)
    .transform((value) => value.replace(/^\/+|\/+$/g, ""))
    .refine(
      (value) => !value.split("/").some((part) => [".", ".."].includes(part.trim())),
      "Invalid folder.",
    )
    .optional(),
  name: z.string().trim().min(1, "Enter a name.").max(120),
  customer: z
    .string()
    .trim()
    .max(120)
    .transform((value) => value || null)
    .nullable()
    .optional(),
  status: orderStatusSchema.default("new"),
  notes: z
    .string()
    .trim()
    .max(2000)
    .transform((value) => value || null)
    .nullable()
    .optional(),
});
export type OrderInput = z.input<typeof orderInputSchema>;

export const orderUpdateSchema = orderInputSchema.partial();
export type OrderUpdate = z.input<typeof orderUpdateSchema>;

export const orderListQuerySchema = z.object({ status: orderStatusSchema.optional() });

export const orderDetailSchema = orderSchema.extend({
  jobs: z.array(jobRecordSchema),
  /** G-code files in the order's folder. */
  files: z.array(libraryFileSchema),
});
export type OrderDetailDto = z.infer<typeof orderDetailSchema>;

export const jobOrderSchema = z.object({ orderId: z.uuid().nullable() });

/** One safe folder name: no path separators or characters that break on Windows/SMB shares. */
export function folderSegment(value: string) {
  const cleaned = value
    .normalize("NFC")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what we remove
    .replace(/[/\\:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .slice(0, 80)
    .trim();
  return cleaned || "_";
}

/**
 * Renders a folder template such as "Customers/{customer}/{year}/{order}".
 * Each "/"-separated part becomes one sanitised folder name; parts that end
 * up empty are dropped.
 */
export function renderFolderTemplate(
  template: string,
  values: { order: string; customer: string | null; date: Date },
) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const vars: Record<string, string> = {
    order: values.order,
    customer: values.customer?.trim() || "No customer",
    year: String(values.date.getFullYear()),
    month: pad(values.date.getMonth() + 1),
    day: pad(values.date.getDate()),
  };
  return template
    .split("/")
    .map((part) => part.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match).trim())
    .filter((part) => part.length > 0)
    .map(folderSegment)
    .join("/");
}
