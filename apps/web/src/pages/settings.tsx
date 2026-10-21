import {
  type CreateUser,
  type DefaultView,
  ORDER_FOLDER_VARIABLES,
  orderFolderTemplateSchema,
  renderFolderTemplate,
  SIDEBAR_GROUPS,
  type SidebarGroup,
  sidebarPreset,
  type UsageMode,
} from "@printrio/shared";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { createElement, type FC, type FormEvent, useRef, useState } from "react";
import { Dialog, Field, FormError, OptionCards, PageHeader, Section } from "../components.tsx";
import { BackupSettings } from "../features/backup-settings.tsx";
import { LicenceSettings } from "../features/licence-settings.tsx";
import { SlicerSettings } from "../features/slicer-settings.tsx";
import { SsoSettings } from "../features/sso-settings.tsx";
import {
  detectLocaleIgnoringChoice,
  LOCALE_NAMES,
  type Locale,
  setLocale,
  storedLocale,
  useT,
} from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { useModules } from "../lib/modules.tsx";
import { groupsQuery, settingsQuery, usersQuery, useUpdateSettings } from "../lib/queries.ts";
import { meQuery } from "../lib/session.ts";
import { type SidebarEntry, toSaved, useSidebar } from "../lib/sidebar.ts";
import { setTheme, type ThemePreference, useTheme } from "../lib/theme.ts";

export const SETTINGS_TABS = [
  "general",
  "sidebar",
  "appearance",
  "slicer",
  "groups",
  "users",
  "sso",
  "licence",
  "backups",
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
const ADMIN_TABS = new Set<string>([
  "general",
  "sidebar",
  "groups",
  "users",
  "sso",
  "licence",
  "backups",
]);

/** Built-in tabs grouped as in the settings navigation. */
const GROUPS: { id: "workspace" | "printers" | "team" | "plan"; tabs: SettingsTab[] }[] = [
  { id: "workspace", tabs: ["general", "appearance", "sidebar"] },
  { id: "printers", tabs: ["groups", "slicer"] },
  { id: "team", tabs: ["users", "sso"] },
  { id: "plan", tabs: ["licence", "backups"] },
];

/** 24×24 stroke icons (lucide-style) for the settings navigation. */
const ICON_PATHS: Record<SettingsTab | "module", string[]> = {
  general: [
    "M4 21v-7",
    "M4 10V3",
    "M12 21v-9",
    "M12 8V3",
    "M20 21v-5",
    "M20 12V3",
    "M1 14h6",
    "M9 8h6",
    "M17 16h6",
  ],
  appearance: ["M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z", "M12 3v18", "M12 3a9 9 0 0 1 0 18"],
  sidebar: ["M3 4h18v16H3z", "M9 4v16"],
  groups: ["M12 2 2 7l10 5 10-5-10-5z", "m2 17 10 5 10-5", "m2 12 10 5 10-5"],
  slicer: ["M12 15V3", "m7 8 5-5 5 5", "M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"],
  users: [
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
    "M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8z",
    "M22 21v-2a4 4 0 0 0-3-3.87",
    "M16 3.13a4 4 0 0 1 0 7.75",
  ],
  sso: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", "m9 12 2 2 4-4"],
  backups: ["M3 5h18v4H3z", "M5 9v10h14V9", "M10 13h4"],
  licence: [
    "M7.5 15.5a4.5 4.5 0 1 0 0-9a4.5 4.5 0 0 0 0 9z",
    "M10.7 9.3 21 2",
    "m18 5 3 3",
    "m15 8 2.5 2.5",
  ],
  module: [
    "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z",
    "M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z",
  ],
};

function SettingsIcon({ name }: { name: SettingsTab | "module" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

const moduleName = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

export function SettingsPage() {
  const t = useT();
  const { tab = "general" } = useSearch({ from: "/app/settings" });
  const { data: me } = useSuspenseQuery(meQuery);
  const isAdmin = me?.role === "admin";
  const { settingsTabs } = useModules();
  const allowed = (id: string) => isAdmin || !ADMIN_TABS.has(id);

  // Built-in groups, then one group per module (tab ids "<module>:<tab>").
  const groups: {
    label: string;
    items: { id: string; label: string; icon: SettingsTab | "module" }[];
  }[] = [
    ...GROUPS.map((group) => ({
      label: t(`settings.sections.${group.id}`),
      items: group.tabs
        .filter(allowed)
        .map((id) => ({ id, label: t(`settings.tabs.${id}`), icon: id })),
    })),
    ...[...new Set(settingsTabs.map((entry) => entry.moduleId))].map((moduleId) => ({
      label: moduleName(moduleId),
      items: settingsTabs
        .filter((entry) => entry.moduleId === moduleId && (isAdmin || !entry.adminOnly))
        .map((entry) => ({
          id: `${moduleId}:${entry.id}`,
          label: entry.label,
          icon: "module" as const,
        })),
    })),
  ].filter((group) => group.items.length > 0);
  const items = groups.flatMap((group) => group.items);
  const active = items.some((entry) => entry.id === tab) ? tab : "appearance";
  const current = items.find((entry) => entry.id === active);
  const moduleTab = settingsTabs.find((entry) => `${entry.moduleId}:${entry.id}` === active);
  const navigate = useNavigate();
  const description = moduleTab
    ? t("settings.descriptions.module", { module: moduleName(moduleTab.moduleId) })
    : t(`settings.descriptions.${active as SettingsTab}`);

  return (
    <main className="mx-auto max-w-6xl px-4 py-5 sm:p-6 md:p-8">
      <PageHeader title={t("settings.title")} />
      {!isAdmin && <p className="mt-2 text-sm text-muted">{t("settings.adminOnly")}</p>}
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[210px_minmax(0,1fr)] md:gap-8">
        <nav aria-label={t("settings.sectionsLabel")} className="min-w-0">
          {/* Phones: every section in one native picker. Desktop: grouped list that stays in view. */}
          <select
            className="input md:hidden"
            aria-label={t("settings.sectionsLabel")}
            value={active}
            onChange={(event) =>
              void navigate({ to: "/settings", search: { tab: event.target.value } })
            }
          >
            {groups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <div className="hidden md:sticky md:top-6 md:grid md:gap-5">
            {groups.map((group) => (
              <div key={group.label} className="grid gap-0.5">
                <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">
                  {group.label}
                </p>
                {group.items.map((item) => (
                  <Link
                    key={item.id}
                    to="/settings"
                    search={{ tab: item.id }}
                    aria-current={active === item.id ? "page" : undefined}
                    className={`flex shrink-0 items-center gap-2.5 rounded-[10px] border px-3 py-2 text-sm whitespace-nowrap ${
                      active === item.id
                        ? "border-accent/25 bg-accent/10 font-semibold text-text"
                        : "border-transparent text-muted hover:bg-surface-2 hover:text-text"
                    }`}
                  >
                    <span className={active === item.id ? "text-accent" : "text-subtle"}>
                      <SettingsIcon name={item.icon} />
                    </span>
                    {item.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </nav>
        <div className="min-w-0">
          <div className="mb-5">
            <h2 className="text-xl font-semibold tracking-tight">{current?.label}</h2>
            <p className="mt-1 text-sm text-muted">{description}</p>
          </div>
          {active === "general" && <GeneralSettings />}
          {active === "sidebar" && <SidebarSettings />}
          {active === "appearance" && <AppearanceSettings />}
          {active === "groups" && <GroupSettings />}
          {active === "users" && <UserSettings />}
          {active === "sso" && <SsoSettings />}
          {active === "slicer" && <SlicerSettings />}
          {active === "licence" && <LicenceSettings />}
          {active === "backups" && <BackupSettings />}
          {moduleTab && createElement(moduleTab.component as FC)}
        </div>
      </div>
    </main>
  );
}

function GeneralSettings() {
  const t = useT();
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const update = useUpdateSettings();
  return (
    <>
      <FormError error={update.error} />
      <Section title={t("settings.usageMode")} hint={t("settings.usageModeHint")}>
        <OptionCards<UsageMode>
          name="usageMode"
          value={settings.usageMode}
          options={[
            {
              value: "single",
              label: t("settings.usageSingle"),
              description: t("settings.usageSingleHint"),
            },
            {
              value: "farm",
              label: t("settings.usageFarm"),
              description: t("settings.usageFarmHint"),
            },
          ]}
          onChange={(usageMode) => update.mutate({ usageMode, sidebar: sidebarPreset(usageMode) })}
        />
      </Section>
      <Section title={t("settings.defaultView")} hint={t("settings.defaultViewHint")}>
        <OptionCards<DefaultView>
          name="defaultView"
          columns={3}
          value={settings.defaultView}
          options={[
            {
              value: "auto",
              label: t("settings.defaultViewAuto"),
              description: t("settings.defaultViewAutoHint"),
            },
            {
              value: "fleet",
              label: t("settings.defaultViewFleet"),
              description: t("settings.defaultViewFleetHint"),
            },
            {
              value: "printer",
              label: t("settings.defaultViewPrinter"),
              description: t("settings.defaultViewPrinterHint"),
            },
          ]}
          onChange={(defaultView) => update.mutate({ defaultView })}
        />
      </Section>
      <CostSettingsSection />
      <OrderFolderSection />
    </>
  );
}

function CostSettingsSection() {
  const t = useT();
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const update = useUpdateSettings();
  const [saved, setSaved] = useState(false);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const number = (name: string) => Number(String(form.get(name) ?? "").replace(",", "."));
    update.mutate(
      {
        costs: {
          currency: String(form.get("currency") ?? "").trim(),
          electricityPrice: number("electricityPrice"),
          defaultPowerWatts: Math.round(number("defaultPowerWatts")),
        },
      },
      { onSuccess: () => setSaved(true) },
    );
  };
  return (
    <Section title={t("settings.costs")} hint={t("settings.costsHint")}>
      <form onSubmit={onSubmit} onChange={() => setSaved(false)}>
        <div className="grid gap-x-4 sm:grid-cols-3">
          <Field
            label={t("settings.currency")}
            name="currency"
            maxLength={3}
            defaultValue={settings.costs.currency}
            hint={t("settings.currencyHint")}
          />
          <Field
            label={t("settings.electricityPrice", { currency: settings.costs.currency })}
            name="electricityPrice"
            inputMode="decimal"
            defaultValue={String(settings.costs.electricityPrice)}
          />
          <Field
            label={t("settings.defaultPower")}
            name="defaultPowerWatts"
            type="number"
            min={0}
            max={5000}
            defaultValue={settings.costs.defaultPowerWatts}
            hint={t("settings.defaultPowerHint")}
          />
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" className="btn btn-primary btn-sm" disabled={update.isPending}>
            {t("common.save")}
          </button>
          {saved && (
            <span role="status" className="text-sm text-success">
              {t("settings.saved")}
            </span>
          )}
        </div>
      </form>
    </Section>
  );
}

/** Template for order folders in Files, with placeholder chips and a live example. */
function OrderFolderSection() {
  const t = useT();
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const update = useUpdateSettings();
  const [enabled, setEnabled] = useState(settings.orderFolders.enabled);
  const [template, setTemplate] = useState(settings.orderFolders.template);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const parsed = orderFolderTemplateSchema.safeParse(template);
  const preview = parsed.success
    ? renderFolderTemplate(parsed.data, {
        order: t("settings.orderFolderExample"),
        customer: t("settings.orderFolderExampleCustomer"),
        date: new Date(),
      })
    : null;
  const dirty =
    enabled !== settings.orderFolders.enabled || template !== settings.orderFolders.template;

  const insert = (name: string) => {
    const input = inputRef.current;
    const token = `{${name}}`;
    const start = input?.selectionStart ?? template.length;
    const end = input?.selectionEnd ?? template.length;
    setTemplate(template.slice(0, start) + token + template.slice(end));
    setSaved(false);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <Section title={t("settings.orderFolders")} hint={t("settings.orderFoldersHint")}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!parsed.success) return;
          update.mutate(
            { orderFolders: { enabled, template: parsed.data } },
            {
              onSuccess: (next) => {
                setTemplate(next.orderFolders.template);
                setSaved(true);
              },
            },
          );
        }}
      >
        <FormError error={update.error} />
        <label className="mb-4 flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              setEnabled(event.target.checked);
              setSaved(false);
            }}
            className="accent-accent"
          />
          {t("settings.orderFoldersEnabled")}
        </label>
        <label className="block text-sm" htmlFor="order-folder-template">
          <span className="mb-1.5 block text-muted">{t("settings.orderFolderTemplate")}</span>
        </label>
        <div className="flex items-center rounded-[11px] border border-line bg-surface-2 pl-3 focus-within:border-accent">
          <span aria-hidden="true" className="font-mono text-sm text-subtle">
            Files /
          </span>
          <input
            id="order-folder-template"
            ref={inputRef}
            className="input min-w-0 flex-1 border-0 bg-transparent font-mono text-sm focus:outline-none"
            value={template}
            disabled={!enabled}
            spellCheck={false}
            aria-invalid={!parsed.success}
            onChange={(event) => {
              setTemplate(event.target.value);
              setSaved(false);
            }}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-subtle">{t("settings.orderFolderTemplateHint")}</span>
          {ORDER_FOLDER_VARIABLES.map((name) => (
            <button
              key={name}
              type="button"
              disabled={!enabled}
              onClick={() => insert(name)}
              className="tap rounded-full border border-line px-2.5 py-0.5 font-mono text-xs text-muted hover:border-accent hover:text-text disabled:opacity-50"
              title={t(`settings.placeholders.${name}`)}
            >
              {`{${name}}`}
            </button>
          ))}
        </div>
        <p
          className={`mt-3 rounded-[10px] px-3 py-2 font-mono text-xs ${
            parsed.success ? "bg-surface-2 text-muted" : "bg-danger/10 text-danger"
          }`}
          role="status"
        >
          {parsed.success
            ? t("settings.orderFolderPreview", { path: `Files/${preview}` })
            : parsed.error.issues[0]?.message}
        </p>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={!dirty || !parsed.success || update.isPending}
          >
            {t("common.save")}
          </button>
          {saved && (
            <span role="status" className="text-sm text-success">
              {t("settings.saved")}
            </span>
          )}
        </div>
      </form>
    </Section>
  );
}

function SidebarSettings() {
  const t = useT();
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const update = useUpdateSettings();
  const { entries, showGroups, saved } = useSidebar();
  const [dragging, setDragging] = useState<string | null>(null);
  const save = (next: SidebarEntry[]) => update.mutate({ sidebar: toSaved(next, saved) });
  const change = (id: string, patch: Partial<SidebarEntry>) =>
    save(entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  /** Moves an entry before `target` (taking its category), or to the end of `group`. */
  const place = (id: string, target: { before: string } | { group: SidebarGroup }) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry || ("before" in target && target.before === id)) return;
    const rest = entries.filter((e) => e.id !== id);
    if ("before" in target) {
      const index = rest.findIndex((e) => e.id === target.before);
      const group = rest[index]?.group ?? entry.group;
      rest.splice(index, 0, { ...entry, group });
    } else rest.push({ ...entry, group: target.group });
    save(rest);
  };
  const moduleName = (id: string) => (id === "pro" ? "Pro" : id === "business" ? "Business" : id);

  return (
    <Section
      title={t("settings.sidebarItems")}
      hint={t("settings.sidebarHint")}
      actions={
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() =>
            update.mutate({ sidebar: sidebarPreset(settings.usageMode), sidebarGroups: true })
          }
        >
          {t("settings.resetSidebar")}
        </button>
      }
    >
      <FormError error={update.error} />
      <label className="mb-4 flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="accent-accent"
          checked={showGroups}
          onChange={(event) => update.mutate({ sidebarGroups: event.target.checked })}
        />
        {t("settings.showGroups")}
      </label>
      <p className="mb-3 text-xs text-subtle">
        {t("settings.visibleCount", {
          count: entries.filter((entry) => entry.visible).length,
          total: entries.length,
        })}
      </p>
      <div className="grid gap-5">
        {SIDEBAR_GROUPS.map((group) => {
          const items = entries.filter((entry) => entry.group === group);
          return (
            <section
              key={group}
              aria-label={t(`nav.groups.${group}`)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => dragging && items.length === 0 && place(dragging, { group })}
            >
              <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">
                {t(`nav.groups.${group}`)}
              </h3>
              {items.length === 0 && (
                <p className="rounded-[10px] border border-dashed border-line px-3 py-2 text-xs text-subtle">
                  {t("settings.groupEmpty")}
                </p>
              )}
              <ol className="grid gap-2">
                {items.map((entry, index) => (
                  <li
                    key={entry.id}
                    draggable
                    onDragStart={() => setDragging(entry.id)}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.stopPropagation();
                      if (dragging) place(dragging, { before: entry.id });
                    }}
                    className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border px-3 py-2 transition-colors ${
                      entry.visible ? "border-line bg-surface-2" : "border-dashed border-line"
                    } ${dragging === entry.id ? "opacity-50" : ""}`}
                  >
                    <span
                      aria-hidden="true"
                      className="cursor-grab text-subtle select-none max-sm:hidden"
                    >
                      ⠿
                    </span>
                    <label className="flex min-w-0 flex-1 items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={entry.visible}
                        onChange={(event) => change(entry.id, { visible: event.target.checked })}
                        aria-label={t("settings.show", { name: entry.label })}
                        className="accent-accent"
                      />
                      <span aria-hidden="true" className="w-4 text-center text-subtle">
                        {entry.icon}
                      </span>
                      <span
                        className={`truncate ${entry.visible ? "" : "text-subtle line-through"}`}
                      >
                        {entry.label}
                      </span>
                      {entry.moduleId && (
                        <span className="rounded-full border border-line px-1.5 text-[10px] text-subtle">
                          {moduleName(entry.moduleId)}
                        </span>
                      )}
                    </label>
                    <select
                      className="input w-auto py-1 text-xs"
                      value={entry.group}
                      aria-label={t("settings.groupOf", { name: entry.label })}
                      onChange={(event) =>
                        place(entry.id, { group: event.target.value as SidebarGroup })
                      }
                    >
                      {SIDEBAR_GROUPS.map((option) => (
                        <option key={option} value={option}>
                          {t(`nav.groups.${option}`)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm px-2"
                      disabled={index === 0}
                      onClick={() => {
                        const previous = items[index - 1];
                        if (previous) place(entry.id, { before: previous.id });
                      }}
                      aria-label={t("settings.moveUp", { name: entry.label })}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm px-2"
                      disabled={index === items.length - 1}
                      onClick={() => {
                        const next = items[index + 1];
                        if (next) place(next.id, { before: entry.id });
                      }}
                      aria-label={t("settings.moveDown", { name: entry.label })}
                    >
                      ↓
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </Section>
  );
}

/** Miniature of the app in a theme (fixed colours: it previews that theme, not the current one). */
function ThemePreview({ mode }: { mode: ThemePreference }) {
  const pane = (dark: boolean) => (
    <div
      className="flex h-full flex-1 gap-1.5 p-2"
      style={{ background: dark ? "#09070f" : "#f6f4fa" }}
    >
      <div className="w-1/4 rounded" style={{ background: dark ? "#0d0a14" : "#efebf6" }} />
      <div className="grid flex-1 content-start gap-1.5">
        <div
          className="h-2 w-2/3 rounded-full"
          style={{ background: dark ? "#39304a" : "#cfc6df" }}
        />
        <div
          className="h-7 rounded"
          style={{
            background: dark ? "#12101b" : "#ffffff",
            border: `1px solid ${dark ? "#292337" : "#e2dcec"}`,
          }}
        />
        <div
          className="h-2 w-1/3 rounded-full"
          style={{ background: dark ? "#a78bfa" : "#7c5ce6" }}
        />
      </div>
    </div>
  );
  return (
    <div aria-hidden="true" className="flex h-20 overflow-hidden rounded-[8px] border border-line">
      {mode === "system" ? (
        <>
          {pane(false)}
          {pane(true)}
        </>
      ) : (
        pane(mode === "dark")
      )}
    </div>
  );
}

const THEME_KEYS = {
  system: ["settings.themeSystem", "settings.themeSystemHint"],
  dark: ["settings.themeDark", "settings.themeDarkHint"],
  light: ["settings.themeLight", "settings.themeLightHint"],
} as const;

function AppearanceSettings() {
  const t = useT();
  const theme = useTheme();
  const stored = storedLocale();
  const automatic = LOCALE_NAMES[detectLocaleIgnoringChoice()];
  return (
    <>
      <Section title={t("settings.language")} hint={t("settings.languageHint")}>
        <select
          className="input max-w-xs"
          aria-label={t("settings.language")}
          value={stored}
          onChange={(event) => setLocale(event.target.value as Locale | "system")}
        >
          <option value="system">{t("settings.languageSystem", { language: automatic })}</option>
          {(Object.keys(LOCALE_NAMES) as Locale[]).map((locale) => (
            <option key={locale} value={locale} lang={locale}>
              {LOCALE_NAMES[locale]}
            </option>
          ))}
        </select>
      </Section>
      <Section title={t("settings.theme")} hint={t("settings.themeHint")}>
        <OptionCards<ThemePreference>
          name="theme"
          columns={3}
          value={theme}
          options={(["system", "dark", "light"] as const).map((mode) => ({
            value: mode,
            label: t(THEME_KEYS[mode][0]),
            description: t(THEME_KEYS[mode][1]),
            preview: <ThemePreview mode={mode} />,
          }))}
          onChange={setTheme}
        />
      </Section>
    </>
  );
}

function GroupSettings() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data } = useQuery(groupsQuery);
  const [name, setName] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: groupsQuery.queryKey });
  const add = useMutation({
    mutationFn: (value: string) =>
      api("/api/printer-groups", { method: "POST", body: { name: value } }),
    onSuccess: () => {
      setName("");
      return refresh();
    },
  });
  const rename = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      api(`/api/printer-groups/${id}`, { method: "PATCH", body: { name: value } }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/printer-groups/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  return (
    <Section title={t("settings.groupsTitle")} hint={t("settings.groupsRenameHint")}>
      <FormError error={add.error ?? rename.error ?? remove.error} />
      <form
        className="mb-5 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) add.mutate(name.trim());
        }}
      >
        <input
          className="input min-w-0 flex-1"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("settings.newGroup")}
          aria-label={t("settings.newGroup")}
          maxLength={60}
        />
        <button type="submit" className="btn btn-primary" disabled={add.isPending}>
          {t("settings.addGroup")}
        </button>
      </form>
      {data?.groups.length ? (
        <ul className="grid gap-2">
          {data.groups.map((group) => (
            <li
              key={group.id}
              className="flex items-center gap-3 rounded-[10px] border border-line bg-surface-2 p-2 pl-3"
            >
              <span aria-hidden="true" className="text-subtle">
                ▦
              </span>
              <input
                className="input min-w-0 flex-1 border-transparent bg-transparent"
                defaultValue={group.name}
                aria-label={group.name}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value && value !== group.name) rename.mutate({ id: group.id, value });
                }}
              />
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => remove.mutate(group.id)}
              >
                {t("common.delete")}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-[10px] border border-dashed border-line px-4 py-6 text-center text-sm text-subtle">
          {t("settings.noGroups")}
        </p>
      )}
    </Section>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function UserSettings() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: me } = useSuspenseQuery(meQuery);
  const { data } = useQuery(usersQuery);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<{ id: string; name: string } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: usersQuery.queryKey });
  const create = useMutation({
    mutationFn: (body: CreateUser) => api("/api/users", { method: "POST", body }),
    onSuccess: () => {
      setAdding(false);
      return refresh();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; role?: "admin" | "operator"; password?: string }) =>
      api(`/api/users/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      setResetting(null);
      return refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/users/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const users = data?.users ?? [];
  const atLimit = data?.limit !== null && data?.limit !== undefined && users.length >= data.limit;

  const onCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    create.mutate({
      email: String(form.get("email")),
      displayName: String(form.get("displayName")),
      password: String(form.get("password")),
      role: form.get("role") === "admin" ? "admin" : "operator",
    });
  };

  return (
    <Section
      title={t("settings.usersTitle")}
      hint={t("users.hint")}
      actions={
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={atLimit}
          onClick={() => setAdding(true)}
        >
          {t("users.add")}
        </button>
      }
    >
      <FormError error={update.error ?? remove.error} />
      <ul className="-my-3 divide-y divide-line">
        {users.map((user) => (
          <li key={user.id} className="flex flex-wrap items-center gap-3 py-3">
            <span
              aria-hidden="true"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-accent/15 text-xs font-bold text-accent"
            >
              {initials(user.displayName)}
            </span>
            <div className="min-w-40 flex-1">
              <p className="truncate text-sm font-semibold">
                {user.displayName}{" "}
                {user.id === me?.id && (
                  <span className="font-normal text-subtle">({t("common.you")})</span>
                )}
              </p>
              <p className="truncate text-xs text-subtle">{user.email}</p>
            </div>
            <select
              className="input w-auto py-1.5 text-sm"
              value={user.role}
              aria-label={`${t("users.role")}: ${user.displayName}`}
              onChange={(event) =>
                update.mutate({ id: user.id, role: event.target.value as "admin" | "operator" })
              }
            >
              <option value="admin">{t("common.admin")}</option>
              <option value="operator">{t("common.operator")}</option>
            </select>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setResetting({ id: user.id, name: user.displayName })}
            >
              {t("users.resetPassword")}
            </button>
            {user.id !== me?.id && (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() =>
                  window.confirm(t("users.deleteConfirm", { name: user.displayName })) &&
                  remove.mutate(user.id)
                }
              >
                {t("common.delete")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {data?.limit !== null && data?.limit !== undefined && (
        <div className="mt-6 border-line border-t pt-4">
          <div className="flex items-center justify-between text-xs text-subtle">
            <span>{t("users.limit", { used: users.length, limit: data.limit })}</span>
            <span>
              {users.length}/{data.limit}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.min(100, (users.length / data.limit) * 100)}%` }}
            />
          </div>
        </div>
      )}

      <Dialog open={adding} onClose={() => setAdding(false)} title={t("users.add")}>
        <form onSubmit={onCreate}>
          <FormError error={create.error} />
          <Field label={t("auth.name")} name="displayName" autoComplete="off" />
          <Field label={t("auth.email")} name="email" type="email" autoComplete="off" />
          <Field
            label={t("auth.passwordHint")}
            name="password"
            type="password"
            minLength={12}
            autoComplete="new-password"
          />
          <label className="mb-4 block text-sm">
            <span className="mb-1.5 block text-muted">{t("users.role")}</span>
            <select name="role" className="input" defaultValue="operator">
              <option value="operator">{t("common.operator")}</option>
              <option value="admin">{t("common.admin")}</option>
            </select>
            <span className="mt-1 block text-xs text-subtle">{t("users.roleHint")}</span>
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setAdding(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>
              {t("users.add")}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={resetting !== null}
        onClose={() => setResetting(null)}
        title={`${t("users.resetPassword")}: ${resetting?.name ?? ""}`}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const password = String(new FormData(event.currentTarget).get("password"));
            if (resetting) update.mutate({ id: resetting.id, password });
          }}
        >
          <FormError error={update.error} />
          <Field
            label={t("users.newPassword")}
            name="password"
            type="password"
            minLength={12}
            autoComplete="new-password"
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setResetting(null)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn btn-primary" disabled={update.isPending}>
              {t("common.save")}
            </button>
          </div>
        </form>
      </Dialog>
    </Section>
  );
}
