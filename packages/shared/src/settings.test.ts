import { describe, expect, it } from "vitest";
import { NAV_ITEM_IDS, sidebarPreset, workspaceSettingsUpdateSchema } from "./settings.ts";

describe("sidebarPreset", () => {
  it("hides business sections for a single-printer setup", () => {
    const hidden = sidebarPreset("single")
      .filter((item) => !item.visible)
      .map((item) => item.id);
    expect(hidden).toEqual(["costs", "orders"]);
  });

  it("shows everything for a farm", () => {
    expect(sidebarPreset("farm").every((item) => item.visible)).toBe(true);
  });
});

describe("sidebar validation", () => {
  it("rejects a sidebar with a missing or duplicated section", () => {
    const items = NAV_ITEM_IDS.map((id) => ({ id, visible: true }));
    expect(workspaceSettingsUpdateSchema.safeParse({ sidebar: items }).success).toBe(true);
    expect(workspaceSettingsUpdateSchema.safeParse({ sidebar: items.slice(1) }).success).toBe(
      false,
    );
    const duplicated = [...items.slice(1), items[1]];
    expect(workspaceSettingsUpdateSchema.safeParse({ sidebar: duplicated }).success).toBe(false);
  });
});
