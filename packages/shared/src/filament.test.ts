import { describe, expect, it } from "vitest";
import { isLowStock } from "./filament.ts";
import { DEFAULT_LOW_STOCK_GRAMS, lowStockThreshold } from "./settings.ts";

const spool = (remainingWeight: number, archived = false) => ({ remainingWeight, archived });

describe("low stock", () => {
  it("is below the threshold, not at it", () => {
    expect(isLowStock(spool(149), 150)).toBe(true);
    expect(isLowStock(spool(149.9), 150)).toBe(true);
    expect(isLowStock(spool(150), 150)).toBe(false);
    expect(isLowStock(spool(900), 150)).toBe(false);
  });

  it("counts an empty spool as low", () => {
    expect(isLowStock(spool(0), 150)).toBe(true);
  });

  it("ignores archived spools", () => {
    expect(isLowStock(spool(10, true), 150)).toBe(false);
  });

  it("is off when the threshold is 0", () => {
    expect(isLowStock(spool(0), 0)).toBe(false);
  });

  it("does not depend on the original spool weight", () => {
    // A 250 g sample spool and a 3 kg spool with the same grams left are equally low.
    expect(isLowStock({ ...spool(120), initialWeight: 250 } as never, 150)).toBe(true);
    expect(isLowStock({ ...spool(120), initialWeight: 3000 } as never, 150)).toBe(true);
  });

  it("uses the default until an administrator sets a value", () => {
    expect(lowStockThreshold({ lowStockGrams: null })).toBe(DEFAULT_LOW_STOCK_GRAMS);
    expect(lowStockThreshold({ lowStockGrams: 0 })).toBe(0);
    expect(lowStockThreshold({ lowStockGrams: 300 })).toBe(300);
  });
});
