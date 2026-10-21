import {
  type NavItemId,
  resolveSidebar,
  type SidebarGroup,
  type SidebarItem,
} from "@printrio/shared";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useT } from "../i18n/index.tsx";
import { MODULE_NAV_GROUPS, NAV_ICONS, NAV_ROUTES } from "../nav.ts";
import { useModules } from "./modules.tsx";
import { settingsQuery } from "./queries.ts";

export interface SidebarEntry extends SidebarItem {
  group: SidebarGroup;
  label: string;
  icon: string;
  /** Core sections link to a route, module entries to /m/<module>/<path>. */
  link: { to: string } | { moduleId: string; path: string };
  /** Module that adds the entry ("pro", "business"), if any. */
  moduleId?: string;
}

/** The sidebar as saved in settings, with module entries resolved and labelled. */
export function useSidebar() {
  const t = useT();
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const { navItems } = useModules();
  const modules = navItems.map((item) => {
    const id = `${item.moduleId}:${item.id}`;
    return { id, item, group: item.group ?? MODULE_NAV_GROUPS[id] };
  });
  const entries: SidebarEntry[] = resolveSidebar(settings.sidebar, modules).map((saved) => {
    const module = modules.find((entry) => entry.id === saved.id);
    if (module)
      return {
        ...saved,
        label: module.item.label,
        icon: module.item.icon,
        link: { moduleId: module.item.moduleId, path: module.item.path },
        moduleId: module.item.moduleId,
      };
    const id = saved.id as NavItemId;
    return { ...saved, label: t(`nav.${id}`), icon: NAV_ICONS[id], link: { to: NAV_ROUTES[id] } };
  });
  return { entries, showGroups: settings.sidebarGroups, saved: settings.sidebar };
}

/**
 * What to save after editing the resolved entries: their order and choices,
 * plus saved entries of modules that are not loaded right now (kept for later).
 */
export function toSaved(entries: SidebarEntry[], saved: SidebarItem[]): SidebarItem[] {
  const shown = new Set(entries.map((entry) => entry.id));
  return [
    ...entries.map(({ id, visible, group }) => ({ id, visible, group })),
    ...saved.filter((item) => !shown.has(item.id)),
  ];
}
