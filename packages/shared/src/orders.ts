import { z } from "zod";
import { jobRecordSchema } from "./jobs.ts";

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
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  jobCount: z.number(),
  /** Sum of the recorded costs (material + energy) of the linked prints. */
  totalCost: z.number(),
  currency: z.string(),
});
export type OrderDto = z.infer<typeof orderSchema>;

export const orderInputSchema = z.object({
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

export const orderDetailSchema = orderSchema.extend({ jobs: z.array(jobRecordSchema) });
export type OrderDetailDto = z.infer<typeof orderDetailSchema>;

export const jobOrderSchema = z.object({ orderId: z.uuid().nullable() });
