import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Brand, Dialog } from "./components.tsx";
import { CommandPalette } from "./features/command-palette.tsx";
import { PrinterForm } from "./features/printer-form.tsx";
import { UpdateBanner } from "./features/updates.tsx";
import { useT } from "./i18n/index.tsx";
import { api } from "./lib/api.ts";
import { ModulesProvider, useModules } from "./lib/modules.tsx";
import { settingsQuery } from "./lib/queries.ts";
import { useRealtime } from "./lib/realtime.ts";
import { meQuery } from "./lib/session.ts";
import { nextTheme, setTheme, useTheme } from "./lib/theme.ts";
import { LIVE_SECTIONS, NAV_ICONS, NAV_ROUTES } from "./nav.ts";

const navLinkClass =
  "flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-[15px] whitespace-nowrap text-muted hover:text-text md:py-2 md:text-sm";
const activeLinkProps = { className: "!border-accent/20 bg-accent/10 !text-text" };

export function AppLayout() {
  return (
    <ModulesProvider>
      <AppShell />
    </ModulesProvider>
  );
}

/** Sidebar entries added by modules (Pro, Business). */
function ModuleNavLinks() {
  const { navItems } = useModules();
  return navItems.map((item) => (
    <Link
      key={`${item.moduleId}:${item.id}`}
      to="/m/$moduleId/$"
      params={{ moduleId: item.moduleId, _splat: item.path }}
      className={navLinkClass}
      activeProps={activeLinkProps}
      activeOptions={{ exact: true }}
    >
      <span aria-hidden="true">{item.icon}</span>
      {item.label}
    </Link>
  ));
}

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

  return (
    <div className="grid min-h-dvh content-start md:grid-cols-[232px_minmax(0,1fr)] md:content-stretch">
      {/* Phones: compact top bar with search and the menu button. */}
      <header className="safe-top sticky top-0 z-30 flex items-center gap-2 border-line border-b bg-sidebar/95 px-4 pb-2 backdrop-blur md:hidden">
        <Link to="/" className="mr-auto flex min-h-11 items-center">
          <Brand size={24} />
        </Link>
        <button
          type="button"
          className="icon-btn"
          onClick={() => window.dispatchEvent(new Event("printrio:palette"))}
          aria-label={t("nav.search")}
        >
          <svg
            viewBox="0 0 24 24"
            width="19"
            height="19"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setMenuOpen(true)}
          aria-label={t("nav.openMenu")}
          aria-expanded={menuOpen}
          aria-controls="app-menu"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </header>
      {menuOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-[#05030acc] backdrop-blur-[2px] md:hidden"
          aria-label={t("nav.closeMenu")}
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        id="app-menu"
        className={`safe-drawer flex min-w-0 flex-col bg-sidebar px-4 py-5 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:w-[min(86vw,320px)] max-md:overflow-y-auto max-md:border-line max-md:border-r max-md:shadow-2xl max-md:transition-transform max-md:duration-200 md:sticky md:top-0 md:h-dvh md:overflow-y-auto md:border-line md:border-r ${
          menuOpen ? "max-md:translate-x-0" : "max-md:invisible max-md:-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between">
          <Link to="/" className="px-2">
            <Brand size={26} />
          </Link>
          <button
            type="button"
            className="icon-btn md:hidden"
            onClick={() => setMenuOpen(false)}
            aria-label={t("nav.closeMenu")}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("printrio:palette"))}
          className="mt-5 hidden w-full items-center justify-between rounded-[10px] border border-line px-3 py-2 text-left text-sm text-subtle hover:text-text md:flex"
        >
          {t("nav.search")}
          <kbd className="rounded border border-line px-1.5 text-[10px]">{t("palette.hint")}</kbd>
        </button>
        <nav aria-label={t("nav.main")} className="mt-5 flex flex-1 flex-col gap-1">
          {settings.sidebar
            .filter((item) => item.visible)
            .map((item) => (
              <Link
                key={item.id}
                to={NAV_ROUTES[item.id]}
                className={navLinkClass}
                activeProps={activeLinkProps}
              >
                <span aria-hidden="true">{NAV_ICONS[item.id]}</span>
                {t(`nav.${item.id}`)}
                {!LIVE_SECTIONS.has(item.id) && (
                  <span className="ml-auto rounded-full border border-line px-1.5 text-[9px] tracking-wide text-subtle uppercase">
                    {t("common.soon")}
                  </span>
                )}
              </Link>
            ))}
          <ModuleNavLinks />
          <Link to="/settings" className={`${navLinkClass} mt-auto`} activeProps={activeLinkProps}>
            <span aria-hidden="true">{NAV_ICONS.settings}</span>
            {t("nav.settings")}
          </Link>
        </nav>
        {/* Phones: account controls live in the drawer (the desktop header is hidden). */}
        <div className="mt-4 flex items-center gap-2 border-line border-t pt-4 md:hidden">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-xs font-bold text-accent-ink"
          >
            {initials}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted">{user?.displayName}</span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setTheme(nextTheme(theme))}
            aria-label={t("palette.toggleTheme")}
          >
            <ThemeIcon />
          </button>
          <button
            type="button"
            onClick={() => logout.mutate()}
            className="btn btn-secondary btn-sm"
          >
            {t("auth.signOut")}
          </button>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="hidden items-center justify-end gap-3 border-line border-b px-6 py-3 md:flex">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setTheme(nextTheme(theme))}
            aria-label={t("palette.toggleTheme")}
            title={t("palette.toggleTheme")}
          >
            <ThemeIcon />
          </button>
          <span className="text-sm text-muted">{user?.displayName}</span>
          <span
            aria-hidden="true"
            className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-[11px] font-bold text-accent-ink"
          >
            {initials}
          </span>
          <button
            type="button"
            onClick={() => logout.mutate()}
            className="btn btn-secondary btn-sm"
          >
            {t("auth.signOut")}
          </button>
        </header>
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
