import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { Brand, Dialog } from "./components.tsx";
import { CommandPalette } from "./features/command-palette.tsx";
import { PrinterForm } from "./features/printer-form.tsx";
import { useT } from "./i18n/index.tsx";
import { api } from "./lib/api.ts";
import { ModulesProvider, useModules } from "./lib/modules.tsx";
import { settingsQuery } from "./lib/queries.ts";
import { useRealtime } from "./lib/realtime.ts";
import { meQuery } from "./lib/session.ts";
import { nextTheme, setTheme, useTheme } from "./lib/theme.ts";
import { LIVE_SECTIONS, NAV_ICONS, NAV_ROUTES } from "./nav.ts";

const navLinkClass =
  "flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-sm whitespace-nowrap text-muted hover:text-text";
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

function AppShell() {
  const t = useT();
  const { data: user } = useSuspenseQuery(meQuery);
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const theme = useTheme();
  const [addingPrinter, setAddingPrinter] = useState(false);
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
    <div className="grid min-h-screen md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="flex min-w-0 flex-col border-line border-b bg-sidebar px-4 py-5 md:sticky md:top-0 md:h-screen md:border-r md:border-b-0">
        <Link to="/" className="px-2">
          <Brand size={26} />
        </Link>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("printrio:palette"))}
          className="mt-5 hidden w-full items-center justify-between rounded-[10px] border border-line px-3 py-2 text-left text-sm text-subtle hover:text-text md:flex"
        >
          {t("nav.search")}
          <kbd className="rounded border border-line px-1.5 text-[10px]">{t("palette.hint")}</kbd>
        </button>
        <nav
          aria-label={t("nav.main")}
          className="mt-5 flex gap-1 overflow-x-auto md:flex-1 md:flex-col md:overflow-visible"
        >
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
                  <span className="ml-auto hidden rounded-full border border-line px-1.5 text-[9px] tracking-wide text-subtle uppercase md:inline">
                    {t("common.soon")}
                  </span>
                )}
              </Link>
            ))}
          <ModuleNavLinks />
          <Link
            to="/settings"
            className={`${navLinkClass} md:mt-auto`}
            activeProps={activeLinkProps}
          >
            <span aria-hidden="true">{NAV_ICONS.settings}</span>
            {t("nav.settings")}
          </Link>
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="flex items-center justify-end gap-3 border-line border-b px-6 py-3">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setTheme(nextTheme(theme))}
            aria-label={t("palette.toggleTheme")}
            title={t("palette.toggleTheme")}
          >
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
              {/* Half-filled circle: the universal light/dark toggle glyph */}
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" />
            </svg>
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
        <Outlet />
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
