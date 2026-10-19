import { describe, expect, it } from "vitest";
import { createTranslator } from "../i18n/index.tsx";
import {
  fanName,
  formatBytes,
  formatDuration,
  formatFilament,
  formatFilamentAmount,
  formatPercent,
  formatRelativeTime,
  heaterName,
} from "./format.ts";

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

  it("names fans for people", () => {
    expect(fanName(t, "fan", "fan")).toBe("Part fan");
    expect(fanName(t, "output_pin fan0", "fan0")).toBe("Fan 0");
    expect(fanName(t, "heater_fan hotend_fan", "hotend_fan")).toBe("Hotend fan");
  });

  it("formats file sizes, filament amounts and relative times", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2_480_133)).toBe("2.4 MB");
    expect(formatFilamentAmount(12.6, 4210)).toBe("13 g");
    expect(formatFilamentAmount(4.9, null)).toBe("4.9 g");
    expect(formatFilamentAmount(null, 4210)).toBe("4.21 m");
    const now = Date.parse("2026-10-19T12:00:00Z");
    expect(formatRelativeTime("2026-10-19T09:00:00Z", now)).toBe("3 hours ago");
    expect(formatRelativeTime("2026-10-18T12:00:00Z", now)).toBe("yesterday");
  });
});
