import { z } from "zod";
import { gcodeDirectorySchema, gcodePathSchema } from "./printers.ts";

/** A G-code file in Printrio's own library (DATA_DIR/files). */
export const libraryFileSchema = z.object({
  path: z.string(),
  name: z.string(),
  size: z.number(),
  modified: z.iso.datetime(),
  slicer: z.string().nullable(),
  estimatedSeconds: z.number().nullable(),
  filamentMm: z.number().nullable(),
  filamentGrams: z.number().nullable(),
  layerHeight: z.number().nullable(),
  objectHeight: z.number().nullable(),
  material: z.string().nullable(),
  hasThumbnail: z.boolean(),
  uploadedBy: z.string().nullable(),
});
export type LibraryFileDto = z.infer<typeof libraryFileSchema>;

export const libraryListingSchema = z.object({
  directory: z.string(),
  directories: z.array(z.string()),
  files: z.array(libraryFileSchema),
});
export type LibraryListingDto = z.infer<typeof libraryListingSchema>;

export const libraryDirectoryQuerySchema = z.object({ dir: gcodeDirectorySchema.default("") });
export const libraryPathQuerySchema = z.object({ path: gcodePathSchema });
export const libraryFolderSchema = z.object({ path: gcodePathSchema });

export const librarySendSchema = z.object({
  path: gcodePathSchema,
  printerId: z.uuid(),
  /** Start printing right after the upload (the printer must be idle). */
  print: z.boolean().default(false),
});
export type LibrarySend = z.input<typeof librarySendSchema>;
