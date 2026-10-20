import {
  activeSpoolSchema,
  type FilamentDto,
  filamentInputSchema,
  type InventoryDto,
  MATERIAL_DENSITY,
  type SpoolDto,
  type SpoolmanImportResult,
  spoolInputSchema,
  spoolmanImportSchema,
  spoolUpdateSchema,
} from "@printrio/shared";
import { and, count, eq, isNotNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.ts";
import { filaments, printers, spools } from "../db/schema.ts";
import { parseOr400, requireAdmin, requireUser } from "./guards.ts";

const idParams = z.object({ id: z.uuid() });
const SPOOLMAN_TIMEOUT_MS = 10_000;

const densityFor = (material: string, density?: number | null) =>
  density ?? MATERIAL_DENSITY[material.toUpperCase()] ?? 1.24;

/**
 * Filament inventory (Free): filament products, spools, manual assignment of a
 * spool to a printer and a one-shot Spoolman import. Automatic consumption
 * tracking and stock alerts are Pro features and are not part of the core.
 */
export function filamentRoutes(app: FastifyInstance, db: Database, onChange: () => void) {
  app.get("/api/inventory", { preHandler: requireUser }, async () => {
    const [filamentRows, spoolRows, loaded, counts] = await Promise.all([
      db.select().from(filaments).orderBy(filaments.vendor, filaments.name),
      db.select().from(spools).orderBy(spools.createdAt),
      db
        .select({ id: printers.id, spoolId: printers.activeSpoolId })
        .from(printers)
        .where(isNotNull(printers.activeSpoolId)),
      db
        .select({ filamentId: spools.filamentId, spools: count() })
        .from(spools)
        .where(eq(spools.archived, false))
        .groupBy(spools.filamentId),
    ]);
    const spoolCount = new Map(counts.map((row) => [row.filamentId, row.spools]));
    const body: InventoryDto = {
      filaments: filamentRows.map(
        (row): FilamentDto => ({
          id: row.id,
          vendor: row.vendor,
          name: row.name,
          material: row.material,
          colorName: row.colorName,
          colorHex: row.colorHex,
          diameter: row.diameter,
          density: row.density,
          spoolWeight: row.spoolWeight,
          emptySpoolWeight: row.emptySpoolWeight,
          price: row.price,
          spoolCount: spoolCount.get(row.id) ?? 0,
        }),
      ),
      spools: spoolRows.map(
        (row): SpoolDto => ({
          id: row.id,
          filamentId: row.filamentId,
          initialWeight: row.initialWeight,
          remainingWeight: row.remainingWeight,
          emptySpoolWeight: row.emptySpoolWeight,
          price: row.price,
          location: row.location,
          lot: row.lot,
          notes: row.notes,
          archived: row.archived,
          printerIds: loaded.filter((p) => p.spoolId === row.id).map((p) => p.id),
          createdAt: row.createdAt.toISOString(),
        }),
      ),
    };
    return body;
  });

  app.post("/api/filaments", { preHandler: requireUser }, async (request, reply) => {
    const input = parseOr400(reply, filamentInputSchema.safeParse(request.body));
    if (!input) return;
    const [row] = await db
      .insert(filaments)
      .values({ ...input, density: densityFor(input.material, input.density) })
      .returning({ id: filaments.id });
    return reply.code(201).send(row);
  });

  app.patch("/api/filaments/:id", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const input = params && parseOr400(reply, filamentInputSchema.safeParse(request.body));
    if (!params || !input) return;
    const [row] = await db
      .update(filaments)
      .set({ ...input, density: densityFor(input.material, input.density) })
      .where(eq(filaments.id, params.id))
      .returning({ id: filaments.id });
    if (!row) return reply.code(404).send({ error: "Filament not found." });
    return row;
  });

  app.delete("/api/filaments/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    const [used] = await db
      .select({ spools: count() })
      .from(spools)
      .where(eq(spools.filamentId, params.id));
    if ((used?.spools ?? 0) > 0)
      return reply.code(409).send({ error: "Delete or move its spools first." });
    const deleted = await db.delete(filaments).where(eq(filaments.id, params.id)).returning();
    if (deleted.length === 0) return reply.code(404).send({ error: "Filament not found." });
    return reply.code(204).send();
  });

  app.post("/api/spools", { preHandler: requireUser }, async (request, reply) => {
    const input = parseOr400(reply, spoolInputSchema.safeParse(request.body));
    if (!input) return;
    const [filament] = await db.select().from(filaments).where(eq(filaments.id, input.filamentId));
    if (!filament) return reply.code(400).send({ error: "Choose an existing filament." });
    const [row] = await db
      .insert(spools)
      .values({
        filamentId: filament.id,
        initialWeight: input.initialWeight,
        remainingWeight: Math.min(
          input.remainingWeight ?? input.initialWeight,
          input.initialWeight,
        ),
        emptySpoolWeight: input.emptySpoolWeight ?? filament.emptySpoolWeight,
        price: input.price ?? filament.price,
        location: input.location ?? null,
        lot: input.lot ?? null,
        notes: input.notes ?? null,
      })
      .returning({ id: spools.id });
    return reply.code(201).send(row);
  });

  app.patch("/api/spools/:id", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const input = params && parseOr400(reply, spoolUpdateSchema.safeParse(request.body));
    if (!params || !input) return;
    const [spool] = await db.select().from(spools).where(eq(spools.id, params.id));
    if (!spool) return reply.code(404).send({ error: "Spool not found." });
    const { measuredGrossWeight, ...changes } = input;
    const initialWeight = changes.initialWeight ?? spool.initialWeight;
    let remainingWeight = changes.remainingWeight ?? spool.remainingWeight;
    if (measuredGrossWeight !== undefined) {
      const empty = changes.emptySpoolWeight ?? spool.emptySpoolWeight;
      if (empty === null)
        return reply.code(400).send({ error: "Set the empty spool weight to weigh this spool." });
      remainingWeight = Math.max(0, measuredGrossWeight - empty);
    }
    await db.transaction(async (tx) => {
      await tx
        .update(spools)
        .set({
          ...changes,
          initialWeight,
          remainingWeight: Math.min(remainingWeight, initialWeight),
        })
        .where(eq(spools.id, params.id));
      // An archived spool is used up or gone; it cannot stay loaded in a printer.
      if (changes.archived)
        await tx
          .update(printers)
          .set({ activeSpoolId: null })
          .where(eq(printers.activeSpoolId, params.id));
    });
    if (changes.archived) onChange();
    return { ok: true };
  });

  app.delete("/api/spools/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    if (!params) return;
    const deleted = await db.delete(spools).where(eq(spools.id, params.id)).returning();
    if (deleted.length === 0) return reply.code(404).send({ error: "Spool not found." });
    onChange();
    return reply.code(204).send();
  });

  app.put("/api/printers/:id/spool", { preHandler: requireUser }, async (request, reply) => {
    const params = parseOr400(reply, idParams.safeParse(request.params));
    const body = params && parseOr400(reply, activeSpoolSchema.safeParse(request.body));
    if (!params || !body) return;
    if (body.spoolId) {
      const [spool] = await db
        .select({ id: spools.id })
        .from(spools)
        .where(and(eq(spools.id, body.spoolId), eq(spools.archived, false)));
      if (!spool) return reply.code(400).send({ error: "Choose an active spool." });
    }
    const updated = await db
      .update(printers)
      .set({ activeSpoolId: body.spoolId })
      .where(eq(printers.id, params.id))
      .returning({ id: printers.id });
    if (updated.length === 0) return reply.code(404).send({ error: "Printer not found." });
    onChange();
    return { ok: true };
  });

  app.post("/api/spools/import/spoolman", { preHandler: requireAdmin }, async (request, reply) => {
    const body = parseOr400(reply, spoolmanImportSchema.safeParse(request.body));
    if (!body) return;
    let data: unknown;
    try {
      const res = await fetch(`${body.url}/api/v1/spool?allow_archived=true`, {
        signal: AbortSignal.timeout(SPOOLMAN_TIMEOUT_MS),
      });
      if (!res.ok) return reply.code(502).send({ error: `Spoolman answered ${res.status}.` });
      data = await res.json();
    } catch {
      return reply.code(502).send({ error: "Spoolman did not respond at this address." });
    }
    const parsed = z.array(spoolmanSpoolSchema).safeParse(data);
    if (!parsed.success)
      return reply.code(502).send({ error: "This does not look like a Spoolman server." });
    const result = await importSpoolman(db, body.url, parsed.data);
    onChange();
    return result;
  });
}

const spoolmanFilamentSchema = z.object({
  id: z.number(),
  name: z.string().nullish(),
  vendor: z.object({ name: z.string() }).nullish(),
  material: z.string().nullish(),
  color_hex: z.string().nullish(),
  diameter: z.number().nullish(),
  density: z.number().nullish(),
  weight: z.number().nullish(),
  spool_weight: z.number().nullish(),
  price: z.number().nullish(),
});

const spoolmanSpoolSchema = z.object({
  id: z.number(),
  filament: spoolmanFilamentSchema,
  initial_weight: z.number().nullish(),
  remaining_weight: z.number().nullish(),
  used_weight: z.number().nullish(),
  spool_weight: z.number().nullish(),
  price: z.number().nullish(),
  location: z.string().nullish(),
  lot_nr: z.string().nullish(),
  comment: z.string().nullish(),
  archived: z.boolean().nullish(),
});
export type SpoolmanSpool = z.infer<typeof spoolmanSpoolSchema>;

/** Creates or updates filaments and spools from Spoolman; re-running the import updates instead of duplicating. */
export async function importSpoolman(
  db: Database,
  url: string,
  items: SpoolmanSpool[],
): Promise<SpoolmanImportResult> {
  const filamentIds = new Map<number, string>();
  let spoolsCreated = 0;
  let spoolsUpdated = 0;
  await db.transaction(async (tx) => {
    for (const item of items) {
      const source = item.filament;
      if (!filamentIds.has(source.id)) {
        const material = source.material?.trim() || "PLA";
        const hex = source.color_hex?.replace(/^#/, "").slice(0, 6);
        const values = {
          vendor: source.vendor?.name ?? null,
          name: source.name?.trim() || material,
          material,
          colorHex: hex && /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toLowerCase()}` : null,
          diameter: source.diameter ?? 1.75,
          density: densityFor(material, source.density),
          spoolWeight: source.weight ?? null,
          emptySpoolWeight: source.spool_weight ?? null,
          price: source.price ?? null,
        };
        const [row] = await tx
          .insert(filaments)
          .values({ ...values, externalId: `spoolman:${url}#filament-${source.id}` })
          .onConflictDoUpdate({ target: filaments.externalId, set: values })
          .returning({ id: filaments.id });
        if (row) filamentIds.set(source.id, row.id);
      }
      const filamentId = filamentIds.get(source.id);
      if (!filamentId) continue;
      const used = item.used_weight ?? 0;
      const initialWeight =
        item.initial_weight ?? source.weight ?? (item.remaining_weight ?? 0) + used;
      const values = {
        filamentId,
        initialWeight,
        remainingWeight: Math.max(0, item.remaining_weight ?? initialWeight - used),
        emptySpoolWeight: item.spool_weight ?? source.spool_weight ?? null,
        price: item.price ?? source.price ?? null,
        location: item.location || null,
        lot: item.lot_nr || null,
        notes: item.comment || null,
        archived: item.archived ?? false,
      };
      const externalId = `spoolman:${url}#spool-${item.id}`;
      const [existing] = await tx
        .select({ id: spools.id })
        .from(spools)
        .where(eq(spools.externalId, externalId));
      if (existing) {
        await tx.update(spools).set(values).where(eq(spools.id, existing.id));
        spoolsUpdated++;
      } else {
        await tx.insert(spools).values({ ...values, externalId });
        spoolsCreated++;
      }
    }
  });
  return { filaments: filamentIds.size, spoolsCreated, spoolsUpdated };
}
