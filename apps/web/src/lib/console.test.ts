import { describe, expect, it } from "vitest";
import { lineTone, macroCall, pushHistory, stepHistory, suggestCommands } from "./console.ts";

describe("console history", () => {
  it("skips immediate repeats and caps the length", () => {
    expect(pushHistory(["G28"], "G28")).toEqual(["G28"]);
    expect(pushHistory(["G28"], "M84")).toEqual(["G28", "M84"]);
    expect(
      pushHistory(
        Array.from({ length: 100 }, (_, i) => `M${i}`),
        "G28",
      ),
    ).toHaveLength(100);
  });

  it("walks up and back down to an empty line", () => {
    const history = ["G28", "M84"];
    let step = stepHistory(history, null, "up");
    expect(step).toEqual({ index: 1, value: "M84" });
    step = stepHistory(history, step.index, "up");
    expect(step).toEqual({ index: 0, value: "G28" });
    expect(stepHistory(history, 0, "up")).toEqual({ index: 0, value: "G28" });
    step = stepHistory(history, 0, "down");
    expect(step).toEqual({ index: 1, value: "M84" });
    expect(stepHistory(history, 1, "down")).toEqual({ index: null, value: "" });
    expect(stepHistory(history, null, "down")).toEqual({ index: null, value: null });
    expect(stepHistory([], null, "up")).toEqual({ index: null, value: null });
  });
});

describe("suggestCommands", () => {
  const commands = [
    { name: "G28", description: "Move to origin" },
    { name: "PRINT_START", description: null },
    { name: "PRINT_END", description: null },
    { name: "SET_PIN", description: null },
    { name: "M117", description: null },
  ];
  it("prefers prefix matches, then substring matches", () => {
    expect(suggestCommands("pri", commands).map((c) => c.name)).toEqual([
      "PRINT_START",
      "PRINT_END",
    ]);
    expect(suggestCommands("_", commands).map((c) => c.name)).toEqual([
      "PRINT_START",
      "PRINT_END",
      "SET_PIN",
    ]);
  });
  it("stays quiet for empty input, parameters and exact matches", () => {
    expect(suggestCommands("", commands)).toEqual([]);
    expect(suggestCommands("G28 X", commands)).toEqual([]);
    expect(suggestCommands("g28", commands)).toEqual([]);
  });
});

describe("macroCall", () => {
  it("adds filled-in parameters and quotes values with spaces", () => {
    expect(macroCall("PRINT_START", { BED: "70", EXTRUDER: " " })).toBe("PRINT_START BED=70");
    expect(macroCall("M117_MSG", { TEXT: "hello world" })).toBe('M117_MSG TEXT="hello world"');
    expect(macroCall("PRINT_END", {})).toBe("PRINT_END");
  });
});

describe("lineTone", () => {
  it("follows Klipper prefixes", () => {
    expect(lineTone('!! Unknown command:"X"')).toBe("error");
    expect(lineTone("// Running PRINT_START")).toBe("info");
    expect(lineTone("ok")).toBe("plain");
  });
});
