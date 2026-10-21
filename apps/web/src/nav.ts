import type { NavItemId, SidebarGroup } from "@printrio/shared";

export const NAV_ROUTES: Record<NavItemId, string> = {
  printers: "/printers",
  jobs: "/jobs",
  files: "/files",
  filament: "/filament",
  costs: "/costs",
  orders: "/orders",
};

export const NAV_ICONS: Record<NavItemId | "settings", string> = {
  printers: "▦",
  jobs: "◷",
  files: "▤",
  filament: "◉",
  costs: "⌁",
  orders: "▣",
  settings: "⚙",
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
  "business:stock": "production",
  "business:sites": "insights",
};
