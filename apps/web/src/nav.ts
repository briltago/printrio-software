import type { NavItemId, SidebarGroup } from "@printrio/shared";
import type { IconName } from "./icons.tsx";

export const NAV_ROUTES: Record<NavItemId, string> = {
  printers: "/printers",
  jobs: "/jobs",
  files: "/files",
  filament: "/filament",
  costs: "/costs",
  orders: "/orders",
};

export const NAV_ICONS: Record<NavItemId | "settings", IconName> = {
  printers: "printers",
  jobs: "jobs",
  files: "library",
  filament: "filament",
  costs: "costs",
  orders: "orders",
  settings: "settings",
};

/** Drawn icons for module entries we know, so the sidebar uses one icon set (others keep the module's own). */
export const MODULE_NAV_ICONS: Record<string, IconName> = {
  "pro:fleet": "queue",
  "pro:production": "production",
  "pro:customers": "customers",
  "pro:stats": "stats",
  "business:pipeline": "pipeline",
  "business:crm": "crm",
  "business:quotes": "quotes",
  "business:invoices": "invoices",
  "business:stock": "stock",
  "business:sites": "sites",
};

/** Sections that already have a real page; the rest show a "Soon" badge. */
export const LIVE_SECTIONS = new Set<NavItemId>([
  "printers",
  "files",
  "filament",
  "jobs",
  "costs",
  "orders",
]);

/** Categories for entries of modules that do not name one (older Pro and Business versions). */
export const MODULE_NAV_GROUPS: Record<string, SidebarGroup> = {
  "pro:fleet": "production",
  "pro:production": "production",
  "pro:customers": "sales",
  "pro:stats": "insights",
  "business:pipeline": "sales",
  "business:crm": "sales",
  "business:quotes": "sales",
  "business:invoices": "sales",
  "business:stock": "workshop",
  "business:sites": "insights",
};

/** Settings navigation groups: by what a tab configures, not by the plan it comes with. */
export const SETTINGS_GROUPS = [
  "workspace",
  "printers",
  "team",
  "sales",
  "integrations",
  "plan",
] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

/** Groups (and icons) for settings tabs of modules that do not name a group; unknown tabs get one per module. */
export const MODULE_SETTINGS_TABS: Record<string, { group: SettingsGroup; icon: IconName }> = {
  "pro:fleet": { group: "printers", icon: "queue" },
  "pro:spools": { group: "printers", icon: "filament" },
  "pro:notifications": { group: "integrations", icon: "bell" },
  "business:escalation": { group: "integrations", icon: "bell" },
  "business:api": { group: "integrations", icon: "plug" },
  "business:roles": { group: "team", icon: "roles" },
  "business:invoicing": { group: "sales", icon: "invoices" },
  "business:price-lists": { group: "sales", icon: "money" },
  "business:eshops": { group: "sales", icon: "cart" },
  "business:overview": { group: "plan", icon: "stats" },
};

/** Where a module's settings tab goes: its own `group`, else the core's placement, else none (own group). */
export function placeModuleSettingsTab(id: string, group?: SettingsGroup) {
  const known = MODULE_SETTINGS_TABS[id];
  return { group: group ?? known?.group, icon: known?.icon ?? ("module" as IconName) };
}
