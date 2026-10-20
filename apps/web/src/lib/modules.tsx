import type {
  PrintrioWebModule,
  WebModuleHost,
  WebNavItem,
  WebOrderPanel,
  WebPage,
  WebPrinterPanel,
  WebSettingsTab,
} from "@printrio/sdk";
import type { LoadedModule } from "@printrio/shared";
import * as ReactQuery from "@tanstack/react-query";
import { queryOptions, useQuery } from "@tanstack/react-query";
import * as React from "react";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import {
  Dialog,
  EmptyState,
  Field,
  FormError,
  PageHeader,
  ProgressBar,
  Section,
} from "../components.tsx";
import { Panel } from "../features/panel.tsx";
import { createTranslator } from "../i18n/index.tsx";
import { api } from "./api.ts";
import * as format from "./format.ts";

export const modulesQuery = queryOptions({
  queryKey: ["modules"],
  queryFn: () => api<{ modules: LoadedModule[] }>("/api/modules"),
});

type WithModule<T> = T & { moduleId: string };

export interface ModuleExtensions {
  navItems: WithModule<WebNavItem>[];
  pages: WithModule<WebPage>[];
  settingsTabs: WithModule<WebSettingsTab>[];
  printerPanels: WithModule<WebPrinterPanel>[];
  orderPanels: WithModule<WebOrderPanel>[];
  /** True until every active module's web part has been imported. */
  loading: boolean;
}

const EMPTY: ModuleExtensions = {
  navItems: [],
  pages: [],
  settingsTabs: [],
  printerPanels: [],
  orderPanels: [],
  loading: false,
};

const ModulesContext = createContext<ModuleExtensions>(EMPTY);

const t = createTranslator();
/** What module web bundles get from the core (see @printrio/sdk web.ts). */
const host: WebModuleHost = {
  React,
  jsxRuntime,
  query: ReactQuery,
  api,
  locale: "en",
  components: {
    Dialog,
    EmptyState,
    Field,
    FormError,
    PageHeader,
    ProgressBar,
    Section,
    Panel,
  } as never,
  format: {
    ...format,
    formatDuration: (seconds: number | null | undefined) => format.formatDuration(t, seconds),
  } as never,
};

declare global {
  interface Window {
    PrintrioHost?: WebModuleHost;
  }
}

/** Imports the web part of each active module and collects its extensions. */
export function ModulesProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery(modulesQuery);
  const [extensions, setExtensions] = useState<ModuleExtensions>({ ...EMPTY, loading: true });
  const key = (data?.modules ?? [])
    .filter((module) => module.web)
    .map((module) => `${module.id}@${module.version}`)
    .join(",");

  const ready = data !== undefined;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    // Bundles reach React through this global (they must not ship their own copy).
    window.PrintrioHost = host;
    const load = async () => {
      const next: ModuleExtensions = {
        navItems: [],
        pages: [],
        settingsTabs: [],
        printerPanels: [],
        orderPanels: [],
        loading: false,
      };
      for (const entry of key ? key.split(",") : []) {
        const [moduleId = "", version = ""] = entry.split("@");
        try {
          const url = `/api/modules/${moduleId}/web.js?v=${encodeURIComponent(version)}`;
          const imported = (await import(/* @vite-ignore */ url)) as {
            default?: PrintrioWebModule;
          };
          const result = imported.default?.setup(host) ?? {};
          const tag = <T,>(items: T[] | undefined) =>
            (items ?? []).map((item) => ({ ...item, moduleId }));
          next.navItems.push(...tag(result.navItems));
          next.pages.push(...tag(result.pages));
          next.settingsTabs.push(...tag(result.settingsTabs));
          next.printerPanels.push(...tag(result.printerPanels));
          next.orderPanels.push(...tag(result.orderPanels));
        } catch (error) {
          console.error(`Module ${moduleId} failed to load:`, error);
        }
      }
      if (!cancelled) setExtensions(next);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [key, ready]);

  return <ModulesContext.Provider value={extensions}>{children}</ModulesContext.Provider>;
}

export const useModules = () => useContext(ModulesContext);
