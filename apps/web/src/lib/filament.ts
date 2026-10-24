import type { FilamentDto, InventoryDto, SpoolDto } from "@printrio/shared";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./api.ts";

export const inventoryQuery = queryOptions({
  queryKey: ["inventory"],
  queryFn: () => api<InventoryDto>("/api/inventory"),
  staleTime: 15_000,
});

/** "Prusament PETG Galaxy Black": vendor, then the name (with the material when the name lacks it). */
export function filamentLabel(filament: Pick<FilamentDto, "vendor" | "name" | "material">) {
  const name = filament.name.toUpperCase().includes(filament.material.toUpperCase())
    ? filament.name
    : `${filament.material} ${filament.name}`;
  return [filament.vendor, name].filter(Boolean).join(" ");
}

export const remainingShare = (spool: Pick<SpoolDto, "remainingWeight" | "initialWeight">) =>
  spool.initialWeight > 0
    ? Math.min(1, Math.max(0, spool.remainingWeight / spool.initialWeight))
    : 0;

export const formatGrams = (grams: number) =>
  grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${Math.round(grams)} g`;

/** Remaining filament length in metres for a weight, diameter (mm) and density (g/cm³). */
export function gramsToMetres(grams: number, diameter: number, density: number) {
  const radiusCm = diameter / 20;
  const gramsPerCm = Math.PI * radiusCm * radiusCm * density;
  return gramsPerCm > 0 ? grams / gramsPerCm / 100 : 0;
}

/** Parses a decimal typed with a comma or a dot; empty → null. */
export function parseDecimal(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "")
    .trim()
    .replace(",", ".");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
