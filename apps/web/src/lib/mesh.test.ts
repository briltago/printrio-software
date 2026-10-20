import { describe, expect, it } from "vitest";
import { divergingColor, divergingExtent, formatMm, gridCoordinate, meshStats } from "./mesh.ts";

describe("bed mesh helpers", () => {
  it("computes min, max and range", () => {
    expect(
      meshStats([
        [0.1, -0.05],
        [0.02, 0],
      ]),
    ).toEqual({
      min: -0.05,
      max: 0.1,
      range: 0.15000000000000002,
    });
    expect(meshStats([])).toBeNull();
  });

  it("uses a symmetric extent so zero is neutral", () => {
    expect(divergingExtent({ min: -0.2, max: 0.05, range: 0.25 })).toBe(0.2);
    expect(divergingExtent({ min: 0, max: 0, range: 0 })).toBe(0.01);
    expect(divergingColor(0, 0.2)).toContain("0%");
    expect(divergingColor(-0.2, 0.2)).toBe(
      "color-mix(in oklab, var(--color-diverging-low) 100%, var(--color-diverging-mid))",
    );
    expect(divergingColor(0.1, 0.2)).toContain("var(--color-diverging-high) 50%");
  });

  it("maps grid indices to bed coordinates and formats heights", () => {
    expect(gridCoordinate(0, 5, 20, 220)).toBe(20);
    expect(gridCoordinate(4, 5, 20, 220)).toBe(220);
    expect(gridCoordinate(2, 5, 20, 220)).toBe(120);
    expect(formatMm(0.0421)).toBe("+0.042 mm");
    expect(formatMm(-0.1)).toBe("−0.100 mm");
  });
});
