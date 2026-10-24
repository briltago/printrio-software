import type { Printer, PrinterGroup } from "@printrio/shared";
import { describe, expect, it } from "vitest";
import { countStates, filterPrinters, isFiltered, NO_FILTER, stateOptions } from "./fleet.ts";

const GROUP = "00000000-0000-4000-8000-000000000001";
const groups: PrinterGroup[] = [{ id: GROUP, name: "Basement" } as PrinterGroup];

function printer(
  name: string,
  state: string,
  extra: Partial<Printer> = {},
  file?: string,
): Printer {
  return {
    id: name,
    name,
    groupId: null,
    tags: [],
    status: {
      state,
      message: null,
      job: file ? { fileName: file, progress: 0.5 } : null,
      temperatures: [],
    },
    ...extra,
  } as unknown as Printer;
}

const fleet = [
  printer("Voron 2.4", "printing", { tags: ["farm"] }, "3DBenchy.gcode"),
  printer("Ender 3", "error", { groupId: GROUP }),
  printer("Trident", "paused", { tags: ["farm"] }, "bracket.gcode"),
  printer("MK3S", "idle", { groupId: GROUP }),
  printer("RatRig", "idle"),
  printer("SV08", "offline"),
  printer("K1", "connecting"),
];

const names = (list: Printer[]) => list.map((p) => p.name);

describe("fleet filters", () => {
  it("counts every state", () => {
    expect(Object.fromEntries(countStates(fleet))).toEqual({
      printing: 1,
      error: 1,
      paused: 1,
      idle: 2,
      offline: 1,
      connecting: 1,
    });
  });

  it("returns exactly the printers in the chosen state", () => {
    for (const [state, expected] of [
      ["printing", ["Voron 2.4"]],
      ["error", ["Ender 3"]],
      ["paused", ["Trident"]],
      ["idle", ["MK3S", "RatRig"]],
      ["offline", ["SV08"]],
      ["connecting", ["K1"]],
    ] as const)
      expect(names(filterPrinters(fleet, groups, { ...NO_FILTER, state }))).toEqual(expected);
    expect(filterPrinters(fleet, groups, NO_FILTER)).toHaveLength(fleet.length);
  });

  it("combines status, group, tag and search", () => {
    expect(
      names(filterPrinters(fleet, groups, { ...NO_FILTER, state: "idle", groupId: GROUP })),
    ).toEqual(["MK3S"]);
    expect(
      names(filterPrinters(fleet, groups, { ...NO_FILTER, tag: "farm", state: "paused" })),
    ).toEqual(["Trident"]);
    // Search covers the name, the group, tags and the file being printed.
    expect(names(filterPrinters(fleet, groups, { ...NO_FILTER, search: "benchy" }))).toEqual([
      "Voron 2.4",
    ]);
    expect(names(filterPrinters(fleet, groups, { ...NO_FILTER, search: "basement" }))).toEqual([
      "Ender 3",
      "MK3S",
    ]);
    expect(filterPrinters(fleet, groups, { ...NO_FILTER, search: "zzz", state: "idle" })).toEqual(
      [],
    );
  });

  it("keeps an active state filter when its last printer changes state", () => {
    const after = fleet.map((p) => (p.name === "Ender 3" ? printer("Ender 3", "idle") : p));
    const counts = countStates(after);
    expect(filterPrinters(after, groups, { ...NO_FILTER, state: "error" })).toEqual([]);
    expect(stateOptions(counts, "error")).toContainEqual({ state: "error", count: 0 });
    expect(stateOptions(counts, "")).not.toContainEqual(
      expect.objectContaining({ state: "error" }),
    );
    expect(isFiltered({ ...NO_FILTER, state: "error" })).toBe(true);
    expect(isFiltered({ ...NO_FILTER, search: "  " })).toBe(false);
  });

  it("orders options by urgency and keeps states it does not know", () => {
    const withUnknown = [...fleet, printer("Future", "cooling")];
    expect(stateOptions(countStates(withUnknown), "").map((o) => o.state)).toEqual([
      "printing",
      "error",
      "paused",
      "idle",
      "offline",
      "connecting",
      "cooling",
    ]);
    expect(names(filterPrinters(withUnknown, groups, { ...NO_FILTER, state: "cooling" }))).toEqual([
      "Future",
    ]);
  });
});
