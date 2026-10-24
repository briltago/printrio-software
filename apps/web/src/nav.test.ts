import { describe, expect, it } from "vitest";
import { MODULE_NAV_GROUPS, placeModuleSettingsTab } from "./nav.ts";

describe("module placement", () => {
  it("puts known module settings tabs with the core tabs they belong to", () => {
    expect(placeModuleSettingsTab("business:roles")).toEqual({ group: "team", icon: "roles" });
    expect(placeModuleSettingsTab("pro:spools").group).toBe("printers");
    expect(placeModuleSettingsTab("business:overview").group).toBe("plan");
    expect(placeModuleSettingsTab("pro:notifications").group).toBe(
      placeModuleSettingsTab("business:escalation").group,
    );
  });

  it("lets a module name its own group", () => {
    expect(placeModuleSettingsTab("business:roles", "plan").group).toBe("plan");
    expect(placeModuleSettingsTab("acme:thing", "sales")).toEqual({
      group: "sales",
      icon: "module",
    });
  });

  it("ignores a group this core does not know", () => {
    expect(placeModuleSettingsTab("acme:thing", "billing" as never).group).toBeUndefined();
    expect(placeModuleSettingsTab("business:roles", "billing" as never).group).toBe("team");
  });

  it("leaves unknown tabs without a group, so they get the module's own", () => {
    expect(placeModuleSettingsTab("acme:thing")).toEqual({ group: undefined, icon: "module" });
  });

  it("keeps Stock next to Filament in the sidebar", () => {
    expect(MODULE_NAV_GROUPS["business:stock"]).toBe("workshop");
  });
});
