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

/** Inputs for job costing (Free: material + energy). */
export const costSettingsSchema = z.object({
  /** ISO 4217 code, e.g. "EUR" or "CZK". */
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Use a three-letter currency code, e.g. EUR.")
    .transform((value) => value.toUpperCase()),
  /** Price of electricity per kWh in that currency. */
  electricityPrice: z.number().min(0).max(100),
  /** Average power draw of a printer while printing, unless set per printer. */
  defaultPowerWatts: z.number().int().min(0).max(5000),
});
export type CostSettings = z.infer<typeof costSettingsSchema>;

/** Placeholders a folder template may use. */
export const ORDER_FOLDER_VARIABLES = ["customer", "order", "year", "month", "day"] as const;
export const DEFAULT_ORDER_FOLDER_TEMPLATE = "Orders/{order}";

/** Folder layout for new orders, e.g. "Commercial/{customer}/{order}". */
export const orderFolderTemplateSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/"))
  .pipe(
    z
      .string()
      .min(1, "Enter a folder template.")
      .max(200, "Keep the template under 200 characters.")
      .refine(
        (value) => value.split("/").every((part) => part.trim() !== ".." && part.trim() !== "."),
        "The template cannot contain . or .. folders.",
      )
      .refine(
        (value) =>
          [...value.matchAll(/\{(\w*)\}?/g)].every(
            (m) =>
              m[0].endsWith("}") &&
              (ORDER_FOLDER_VARIABLES as readonly string[]).includes(m[1] ?? ""),
          ),
        `Unknown placeholder. Use ${ORDER_FOLDER_VARIABLES.map((v) => `{${v}}`).join(", ")}.`,
      ),
  );

export const orderFolderSettingsSchema = z.object({
  /** Create a folder in Files for each new order. */
  enabled: z.boolean(),
  template: orderFolderTemplateSchema,
});
export type OrderFolderSettings = z.infer<typeof orderFolderSettingsSchema>;

export const workspaceSettingsSchema = z.object({
  onboardingCompleted: z.boolean(),
  usageMode: usageModeSchema,
  defaultView: defaultViewSchema,
  sidebar: sidebarSchema,
  costs: costSettingsSchema,
  orderFolders: orderFolderSettingsSchema,
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
  costs: { currency: "EUR", electricityPrice: 0.25, defaultPowerWatts: 120 },
  orderFolders: { enabled: true, template: DEFAULT_ORDER_FOLDER_TEMPLATE },
};
