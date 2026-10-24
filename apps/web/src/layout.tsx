import { type NavItemId, SIDEBAR_GROUPS, type SidebarGroup } from "@printrio/shared";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Brand, Dialog } from "./components.tsx";
import { AboutLine } from "./features/about.tsx";
import { CommandPalette } from "./features/command-palette.tsx";
import { PrinterForm } from "./features/printer-form.tsx";
import { UpdateBanner } from "./features/updates.tsx";
import { useT } from "./i18n/index.tsx";
import { Icon, NavIcon } from "./icons.tsx";
import { api } from "./lib/api.ts";
import { ModulesProvider } from "./lib/modules.tsx";
import { settingsQuery } from "./lib/queries.ts";
import { useRealtime } from "./lib/realtime.ts";
import { meQuery } from "./lib/session.ts";
import { type SidebarEntry, useSidebar } from "./lib/sidebar.ts";
import { useStoredState } from "./lib/stored-state.ts";
import { nextTheme, setTheme, useTheme } from "./lib/theme.ts";
import { LIVE_SECTIONS, NAV_ICONS } from "./nav.ts";

const navLinkClass =
  "group flex min-h-11 items-center gap-2.5 rounded-[7px] px-2.5 text-[15px] whitespace-nowrap text-muted hover:bg-surface-2 hover:text-text md:min-h-[30px] md:text-sm";
const activeLinkProps = {
  className: "bg-surface-2 font-semibold !text-text shadow-[inset_0_0_0_1px_var(--color-line)]",
};

export function AppLayout() {
  return (
    <ModulesProvider>
      <AppShell />
    </ModulesProvider>
  );
}

function NavEntry({ entry }: { entry: SidebarEntry }) {
  const t = useT();
  const content = (
    <>
      <span className="text-subtle group-hover:text-muted group-aria-[current=page]:text-accent">
        <NavIcon icon={entry.icon} />
      </span>
      <span className="truncate">{entry.label}</span>
      {!entry.moduleId && !LIVE_SECTIONS.has(entry.id as NavItemId) && (
        <span className="ml-auto rounded border border-line px-1.5 text-[10px] text-subtle">
          {t("common.soon")}
        </span>
      )}
    </>
  );
  return "to" in entry.link ? (
    <Link to={entry.link.to} className={navLinkClass} activeProps={activeLinkProps}>
      {content}
    </Link>
  ) : (
    <Link
      to="/m/$moduleId/$"
      params={{ moduleId: entry.link.moduleId, _splat: entry.link.path }}
      className={navLinkClass}
      activeProps={activeLinkProps}
      activeOptions={{ exact: true }}
    >
      {content}
    </Link>
  );
}

/** Core and module sections, by category (Settings → Sidebar). Categories fold away per browser. */
function NavEntries() {
  const { entries, showGroups } = useSidebar();
  const visible = entries.filter((entry) => entry.visible);
  if (!showGroups)
    return (
      <div className="flex flex-col gap-0.5">
        {visible.map((entry) => (
          <NavEntry key={entry.id} entry={entry} />
        ))}
      </div>
    );
  return SIDEBAR_GROUPS.map((group) => {
    const items = visible.filter((entry) => entry.group === group);
    if (items.length === 0) return null;
    return <NavGroup key={group} group={group} items={items} />;
  });
}

function NavGroup({ group, items }: { group: SidebarGroup; items: SidebarEntry[] }) {
  const t = useT();
  const [state, setState] = useStoredState<"open" | "closed">(`printrio-nav-${group}`, "open");
  const open = state === "open";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // A folded category still shows the page you are on.
  const shown = open ? items : items.filter((entry) => isCurrent(entry, pathname));
  const listId = `nav-group-${group}`;
  return (
    <div className="flex flex-col [&+&]:mt-2.5">
      <button
        type="button"
        aria-controls={listId}
        className="flex min-h-9 items-center gap-1 rounded-[6px] px-2.5 text-left text-xs font-medium text-subtle hover:text-text md:min-h-6"
        aria-expanded={open}
        onClick={() => setState(open ? "closed" : "open")}
      >
        {t(`nav.groups.${group}`)}
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>
          <Icon name="chevron" size={12} />
        </span>
        {!open && <span className="ml-auto tabular-nums">{items.length}</span>}
      </button>
      <div id={listId} className="flex flex-col">
        {shown.map((entry) => (
          <NavEntry key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}

const isCurrent = (entry: SidebarEntry, pathname: string) =>
  "to" in entry.link
    ? pathname === entry.link.to || pathname.startsWith(`${entry.link.to}/`)
    : pathname.replace(/\/$/, "") ===
      `/m/${entry.link.moduleId}/${entry.link.path}`.replace(/\/$/, "");

/** Half-filled circle: the universal light/dark toggle glyph. */
function ThemeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" />
    </svg>
  );
}

function AppShell() {
  const t = useT();
  const { data: user } = useSuspenseQuery(meQuery);
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const theme = useTheme();
  const [addingPrinter, setAddingPrinter] = useState(false);
  // Phones: the sidebar is a drawer opened from the top bar.
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.href });
  // biome-ignore lint/correctness/useExhaustiveDependencies: close the drawer whenever the page changes.
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    document.documentElement.classList.add("menu-open");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("menu-open");
    };
  }, [menuOpen]);
  const openAddPrinter = useCallback(() => setAddingPrinter(true), []);
  useRealtime();

  const logout = useMutation({
    mutationFn: () => api("/api/auth/logout", { method: "POST" }),
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: "/login" });
    },
  });
  const initials = (user?.displayName ?? "?")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const openPalette = () => window.dispatchEvent(new Event("printrio:palette"));

  return (
    <div className="grid min-h-dvh content-start md:grid-cols-[236px_minmax(0,1fr)] md:content-stretch">
      {/* Phones: compact top bar with search and the menu button. */}
      <header className="safe-top sticky top-0 z-30 flex items-center gap-1 border-line border-b bg-sidebar px-4 pb-2 md:hidden">
        <Link to="/" className="mr-auto flex min-h-11 items-center">
          <Brand size={24} />
        </Link>
        <button
          type="button"
          className="icon-btn"
          onClick={openPalette}
          aria-label={t("nav.search")}
        >
          <Icon name="search" size={19} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setMenuOpen(true)}
          aria-label={t("nav.openMenu")}
          aria-expanded={menuOpen}
          aria-controls="app-menu"
        >
          <Icon name="menu" size={20} />
        </button>
      </header>
      {menuOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-[#05060acc] md:hidden"
          aria-label={t("nav.closeMenu")}
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        id="app-menu"
        className={`safe-drawer flex min-w-0 flex-col bg-sidebar pr-3 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:w-[min(86vw,320px)] max-md:border-line max-md:border-r max-md:shadow-2xl max-md:transition-transform max-md:duration-200 md:sticky md:top-0 md:h-dvh md:border-line md:border-r ${
          menuOpen ? "max-md:translate-x-0" : "max-md:invisible max-md:-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between">
          <Link to="/" className="flex min-h-10 items-center px-2.5">
            <Brand size={24} />
          </Link>
          <button
            type="button"
            className="icon-btn md:hidden"
            onClick={() => setMenuOpen(false)}
            aria-label={t("nav.closeMenu")}
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <button
          type="button"
          onClick={openPalette}
          className="mt-3 hidden min-h-8 w-full items-center gap-2 rounded-[7px] border border-line bg-field px-2.5 text-left text-sm text-subtle hover:border-line-strong hover:text-text md:flex"
        >
          <Icon name="search" size={14} />
          <span className="flex-1">{t("nav.search")}</span>
          <kbd className="font-sans text-[11px]">{t("palette.hint")}</kbd>
        </button>
        <nav
          aria-label={t("nav.main")}
          className="scroll-shadows -mr-3 mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto pr-3 [scrollbar-width:thin]"
        >
          <NavEntries />
        </nav>
        <div className="mt-3 flex flex-col gap-0.5 border-line border-t pt-3">
          <Link to="/settings" className={navLinkClass} activeProps={activeLinkProps}>
            <span className="text-subtle group-hover:text-muted group-aria-[current=page]:text-accent">
              <Icon name={NAV_ICONS.settings} />
            </span>
            {t("nav.settings")}
          </Link>
          <div className="flex items-center gap-1 pl-2.5">
            <span
              aria-hidden="true"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-[6px] bg-surface-2 text-[10px] font-bold text-muted shadow-[inset_0_0_0_1px_var(--color-line)]"
            >
              {initials}
            </span>
            <span className="ml-1.5 min-w-0 flex-1 truncate text-sm text-muted" title={user?.email}>
              {user?.displayName}
            </span>
            <button
              type="button"
              className="icon-btn md:h-8 md:w-8"
              onClick={() => setTheme(nextTheme(theme))}
              aria-label={t("palette.toggleTheme")}
              title={t("palette.toggleTheme")}
            >
              <ThemeIcon />
            </button>
            <button
              type="button"
              className="icon-btn md:h-8 md:w-8"
              onClick={() => logout.mutate()}
              aria-label={t("auth.signOut")}
              title={t("auth.signOut")}
            >
              <Icon name="signOut" />
            </button>
          </div>
        </div>
        <AboutLine className="mt-2 px-2.5" />
      </aside>
      <div className="min-w-0">
        <UpdateBanner admin={user?.role === "admin"} />
        <div className="safe-bottom">
          <Outlet />
        </div>
      </div>
      <CommandPalette onAddPrinter={openAddPrinter} />
      <Dialog open={addingPrinter} onClose={() => setAddingPrinter(false)} title={t("printer.add")}>
        <PrinterForm
          onSaved={() => setAddingPrinter(false)}
          onCancel={() => setAddingPrinter(false)}
          submitLabel={t("printer.add")}
        />
      </Dialog>
    </div>
  );
}
