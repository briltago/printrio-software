import type { NavItemId } from "@printrio/shared";

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
