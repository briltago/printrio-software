import { describe, expect, it } from "vitest";
import {
  filamentLabel,
  formatGrams,
  gramsToMetres,
  parseDecimal,
  remainingShare,
} from "./filament.ts";

describe("filament helpers", () => {
  it("labels filaments without repeating the material", () => {
    expect(filamentLabel({ vendor: "Prusament", name: "Galaxy Black", material: "PETG" })).toBe(
      "Prusament PETG Galaxy Black",
    );
    expect(filamentLabel({ vendor: null, name: "PLA Basic", material: "PLA" })).toBe("PLA Basic");
  });

  it("computes the remaining share and formats weights", () => {
    expect(remainingShare({ remainingWeight: 250, initialWeight: 1000 })).toBe(0.25);
    expect(remainingShare({ remainingWeight: 10, initialWeight: 0 })).toBe(0);
    expect(formatGrams(450)).toBe("450 g");
    expect(formatGrams(1250)).toBe("1.25 kg");
  });

  it("converts weight to length", () => {
    // 1 kg of 1.75 mm PLA is roughly 330 m.
    expect(Math.round(gramsToMetres(1000, 1.75, 1.24))).toBe(335);
  });

  it("parses decimals with a comma or a dot", () => {
    expect(parseDecimal("29,99")).toBe(29.99);
    expect(parseDecimal(" 12.5 ")).toBe(12.5);
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
  });
});
