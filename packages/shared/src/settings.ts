import { z } from "zod";

export const usageModeSchema = z.enum(["single", "farm"]);
export type UsageMode = z.infer<typeof usageModeSchema>;

/** auto: one printer opens its detail view, several open the fleet view. */
export const defaultViewSchema = z.enum(["auto", "fleet", "printer"]);
export type DefaultView = z.infer<typeof defaultViewSchema>;

/** Sidebar sections that can be shown, hidden and reordered. Settings is always shown. */
export const NAV_ITEM_IDS = ["printers", "jobs", "files", "filament", "costs", "orders"] as const;
export const navItemIdSchema = z.enum(NAV_ITEM_IDS);
export type NavItemId = z.infer<typeof navItemIdSchema>;

export const sidebarItemSchema = z.object({ id: navItemIdSchema, visible: z.boolean() });
export type SidebarItem = z.infer<typeof sidebarItemSchema>;

const sidebarSchema = z
  .array(sidebarItemSchema)
  .refine(
    (items) =>
      items.length === NAV_ITEM_IDS.length &&
      new Set(items.map((item) => item.id)).size === NAV_ITEM_IDS.length,
    "The sidebar must list every section exactly once.",
  );

export const workspaceSettingsSchema = z.object({
  onboardingCompleted: z.boolean(),
  usageMode: usageModeSchema,
  defaultView: defaultViewSchema,
  sidebar: sidebarSchema,
});
export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;

export const workspaceSettingsUpdateSchema = workspaceSettingsSchema.partial();
export type WorkspaceSettingsUpdate = z.infer<typeof workspaceSettingsUpdateSchema>;

/** Sidebar defaults per usage mode: a single-printer setup starts lean, a farm sees everything. */
export function sidebarPreset(mode: UsageMode): SidebarItem[] {
  const hiddenForSingle = new Set<NavItemId>(["costs", "orders"]);
  return NAV_ITEM_IDS.map((id) => ({
    id,
    visible: mode === "farm" || !hiddenForSingle.has(id),
  }));
}

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  onboardingCompleted: false,
  usageMode: "single",
  defaultView: "auto",
  sidebar: sidebarPreset("single"),
};
