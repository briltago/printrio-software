/** Inputs of a job cost; unknown parts stay null rather than guessed. */
export interface CostInput {
  filamentMm: number;
  printSeconds: number;
  /** Filament of the loaded spool (diameter mm, density g/cm³), if any. */
  filament: { diameter: number; density: number } | null;
  /** Price and net weight of the loaded spool, for the price per gram. */
  spool: { price: number | null; initialWeight: number } | null;
  powerWatts: number;
  electricityPrice: number;
}

export interface JobCost {
  filamentGrams: number | null;
  materialCost: number | null;
  energyKwh: number;
  energyCost: number;
  totalCost: number;
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Weight of a length of filament: cross-section (mm²) × length (mm) = mm³; /1000 = cm³; × density. */
export function filamentGrams(mm: number, diameter: number, density: number) {
  const area = Math.PI * (diameter / 2) ** 2;
  return (area * mm * density) / 1000;
}

/** Print cost in the Free edition: material (spool price per gram) + energy (power × time). */
export function computeJobCost(input: CostInput): JobCost {
  const grams = input.filament
    ? filamentGrams(input.filamentMm, input.filament.diameter, input.filament.density)
    : null;
  const pricePerGram =
    input.spool?.price != null && input.spool.initialWeight > 0
      ? input.spool.price / input.spool.initialWeight
      : null;
  const materialCost = grams !== null && pricePerGram !== null ? grams * pricePerGram : null;
  const energyKwh = (input.powerWatts * input.printSeconds) / 3_600_000;
  const energyCost = energyKwh * input.electricityPrice;
  return {
    filamentGrams: grams === null ? null : round(grams, 2),
    materialCost: materialCost === null ? null : round(materialCost, 4),
    energyKwh: round(energyKwh, 4),
    energyCost: round(energyCost, 4),
    totalCost: round((materialCost ?? 0) + energyCost, 4),
  };
}
