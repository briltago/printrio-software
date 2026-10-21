/**
 * Web part of a module. The core imports `/api/modules/<id>/web.js` after
 * sign-in and calls `setup(host)`. Modules must not bundle React: they use the
 * host's copy (`host.React`, `host.jsxRuntime`), so hooks and context work.
 */

// The SDK has no React dependency; modules type these with their own @types/react.
type Component = (props: Record<string, unknown>) => unknown;

export interface WebModuleHost {
  React: unknown;
  /** `react/jsx-runtime` of the host. */
  jsxRuntime: unknown;
  /** `@tanstack/react-query` of the host (useQuery, useMutation, useQueryClient). */
  query: unknown;
  /** JSON fetch with the session cookie; throws on non-2xx. */
  api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T>;
  /** Current UI language, e.g. "en". */
  locale: string;
  /** Shared UI building blocks so modules look native. */
  components: Record<string, Component>;
  /** Formatting helpers (formatMoney, formatWeight, formatDuration, …). */
  format: Record<string, (...args: never[]) => string>;
}

export interface WebNavItem {
  id: string;
  label: string;
  icon: string;
  /** Page path below /m/<module id>/, "" for the module's main page. */
  path: string;
  /** Default sidebar category; users can move the entry in Settings → Sidebar. */
  group?: "workshop" | "production" | "sales" | "insights";
}

export interface WebPage {
  path: string;
  title: string;
  component: Component;
}

export interface WebSettingsTab {
  id: string;
  label: string;
  adminOnly?: boolean;
  component: Component;
}

export interface WebPrinterPanel {
  id: string;
  title: string;
  /** Receives `{ printerId }`. */
  component: Component;
}

export interface WebOrderPanel {
  id: string;
  title: string;
  /** Receives `{ orderId }`; shown in the order detail below the core sections. */
  component: Component;
}

export interface WebModuleExtensions {
  navItems?: WebNavItem[];
  pages?: WebPage[];
  settingsTabs?: WebSettingsTab[];
  printerPanels?: WebPrinterPanel[];
  /** Optional; cores before Nov 2026 ignore it. */
  orderPanels?: WebOrderPanel[];
}

export interface PrintrioWebModule {
  id: string;
  setup(host: WebModuleHost): WebModuleExtensions;
}
