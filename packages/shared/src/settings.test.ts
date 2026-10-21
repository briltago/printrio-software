import { describe, expect, it } from "vitest";
import {
  NAV_ITEM_IDS,
  resolveSidebar,
  sidebarPreset,
  workspaceSettingsUpdateSchema,
} from "./settings.ts";

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

describe("resolveSidebar", () => {
  it("groups entries, keeps saved choices and adds new module entries to their category", () => {
    const saved = [
      ...sidebarPreset("farm").map(({ id, visible }) => ({ id, visible })), // saved before categories
      { id: "pro:stats", visible: false, group: "workshop" as const },
      { id: "business:crm", visible: true }, // Business not loaded
    ];
    const resolved = resolveSidebar(saved, [
      { id: "pro:stats", group: "insights" },
      { id: "pro:fleet", group: "production" },
    ]);
    expect(resolved.map((item) => `${item.group}/${item.id}`)).toEqual([
      "workshop/printers",
      "workshop/jobs",
      "workshop/files",
      "workshop/filament",
      "workshop/pro:stats",
      "production/orders",
      "production/pro:fleet",
      "insights/costs",
    ]);
    expect(resolved.find((item) => item.id === "pro:stats")?.visible).toBe(false);
  });

  it("accepts module entries and rejects malformed ids", () => {
    const items = [
      ...sidebarPreset("farm"),
      { id: "pro:fleet", visible: true, group: "production" },
    ];
    expect(workspaceSettingsUpdateSchema.safeParse({ sidebar: items }).success).toBe(true);
    const bad = [...sidebarPreset("farm"), { id: "<script>", visible: true }];
    expect(workspaceSettingsUpdateSchema.safeParse({ sidebar: bad }).success).toBe(false);
  });
});
