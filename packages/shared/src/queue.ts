import { z } from "zod";
import { gcodePathSchema } from "./printers.ts";

/** A file waiting to be printed on one printer (Free: per-printer queue, started by hand). */
export const queueItemSchema = z.object({
  id: z.uuid(),
  path: z.string(),
  orderId: z.uuid().nullable(),
  orderName: z.string().nullable(),
  addedBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type QueueItemDto = z.infer<typeof queueItemSchema>;

export const queueAddSchema = z.object({
  path: gcodePathSchema,
  orderId: z.uuid().nullable().optional(),
  /** Number of copies to queue (each is one print). */
  copies: z.number().int().min(1).max(50).default(1),
});
export type QueueAdd = z.input<typeof queueAddSchema>;

export const queueReorderSchema = z.object({ ids: z.array(z.uuid()).max(500) });
