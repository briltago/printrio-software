/**
 * What a change request does, for custom roles (Business). Admins can always
 * do everything; operators can do everything a module's role does not forbid.
 * Only requests that change something are mapped — viewing stays open to every
 * signed-in user.
 */
export const PERMISSIONS = [
  "printers.control",
  "printers.manage",
  "files.manage",
  "queue.manage",
  "orders.manage",
  "filament.manage",
  "module.pro",
  "module.business",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "printers.control": "Control printers (start, pause, G-code, power, calibration)",
  "printers.manage": "Add and configure printers, groups, firmware config and updates",
  "files.manage": "Upload, send and delete G-code",
  "queue.manage": "Change print queues and start the next print",
  "orders.manage": "Create and change orders, link prints",
  "filament.manage": "Filament, spools and loading spools",
  "module.pro": "Pro tools: fleet queue, order items, customers, notifications",
  "module.business": "Business: quotes, invoices, CRM, shipping",
};

const RULES: [RegExp, Permission][] = [
  [/^\/api\/printers\/:id\/queue(\/|$)/, "queue.manage"],
  [/^\/api\/printers\/:id\/files(\/|$)/, "files.manage"],
  [/^\/api\/printers\/:id\/spool$/, "filament.manage"],
  [/^\/api\/printers\/:id\/(commands|power|bed-mesh)(\/|$)/, "printers.control"],
  [/^\/api\/printers(\/|$)/, "printers.manage"],
  [/^\/api\/printer-groups(\/|$)/, "printers.manage"],
  [/^\/api\/library(\/|$)/, "files.manage"],
  [/^\/api\/orders(\/|$)/, "orders.manage"],
  [/^\/api\/jobs\/:id\/order$/, "orders.manage"],
  [/^\/api\/(filaments|spools)(\/|$)/, "filament.manage"],
];

/**
 * The permission a request needs, from its method and route pattern
 * (e.g. "/api/printers/:id/commands"); null when roles do not apply.
 */
export function permissionFor(method: string, route: string, url = route): Permission | null {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  const module = /^\/api\/modules\/(pro|business)\//.exec(url);
  if (module) return `module.${module[1]}` as Permission;
  for (const [pattern, permission] of RULES) if (pattern.test(route)) return permission;
  return null;
}
