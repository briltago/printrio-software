import { describe, expect, it } from "vitest";
import { computeJobCost, filamentGrams } from "../src/jobs/cost.ts";

describe("job cost", () => {
  it("converts filament length to weight", () => {
    // 1 m of 1.75 mm PLA (1.24 g/cm³) weighs about 2.98 g.
    expect(filamentGrams(1000, 1.75, 1.24)).toBeCloseTo(2.982, 2);
  });

  it("adds material and energy", () => {
    const cost = computeJobCost({
      filamentMm: 10_000,
      printSeconds: 2 * 3600,
      filament: { diameter: 1.75, density: 1.24 },
      spool: { price: 25, initialWeight: 1000 },
      powerWatts: 150,
      electricityPrice: 0.3,
    });
    expect(cost.filamentGrams).toBeCloseTo(29.82, 1);
    expect(cost.materialCost).toBeCloseTo(0.7456, 3);
    expect(cost.energyKwh).toBe(0.3);
    expect(cost.energyCost).toBeCloseTo(0.09, 4);
    expect(cost.totalCost).toBeCloseTo(0.8356, 3);
  });

  it("leaves material cost unknown without a priced spool", () => {
    const base = {
      filamentMm: 1000,
      printSeconds: 3600,
      filament: null,
      spool: null,
      powerWatts: 100,
      electricityPrice: 0.2,
    };
    expect(computeJobCost(base)).toEqual({
      filamentGrams: null,
      materialCost: null,
      energyKwh: 0.1,
      energyCost: 0.02,
      totalCost: 0.02,
    });
    const unpriced = computeJobCost({
      ...base,
      filament: { diameter: 1.75, density: 1.24 },
      spool: { price: null, initialWeight: 1000 },
    });
    expect(unpriced.filamentGrams).toBeCloseTo(2.98, 2);
    expect(unpriced.materialCost).toBeNull();
  });
});
