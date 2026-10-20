import { z } from "zod";

export const apiKeySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  prefix: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type ApiKeyDto = z.infer<typeof apiKeySchema>;

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1, "Enter a name, e.g. the computer with the slicer.").max(80),
});

/** Returned once on creation; only a hash is stored. */
export const apiKeyCreatedSchema = apiKeySchema.extend({ key: z.string() });
export type ApiKeyCreatedDto = z.infer<typeof apiKeyCreatedSchema>;
