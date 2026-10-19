import { describe, expect, it } from "vitest";
import { createTranslator } from "../i18n/index.tsx";
import { formatDuration, formatFilament, formatPercent, heaterName } from "./format.ts";

const t = createTranslator("en");

describe("translator", () => {
  it("resolves nested keys and interpolates parameters", () => {
    expect(t("fleet.subtitle", { count: 3, printing: 2 })).toBe("3 printers · 2 printing");
  });

  it("falls back to English for unknown locales", () => {
    expect(createTranslator("xx")("nav.printers")).toBe("Printers");
  });
});

describe("formatting", () => {
  it("formats durations, percentages and filament length", () => {
    expect(formatDuration(t, 2 * 3600 + 5 * 60)).toBe("2 h 5 min");
    expect(formatDuration(t, 59 * 60)).toBe("59 min");
    expect(formatDuration(t, null)).toBe("—");
    expect(formatPercent(0.426)).toBe("43%");
    expect(formatFilament(5120)).toBe("5.12 m");
    expect(formatFilament(640)).toBe("640 mm");
  });

  it("gives Klipper heaters readable names", () => {
    expect(heaterName(t, "extruder")).toBe("Nozzle");
    expect(heaterName(t, "extruder1")).toBe("Nozzle 2");
    expect(heaterName(t, "heater_bed")).toBe("Bed");
    expect(heaterName(t, "chamber_fan")).toBe("chamber fan");
  });
});
