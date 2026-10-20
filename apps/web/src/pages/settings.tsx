import {
  type CreateUser,
  type DefaultView,
  type NavItemId,
  type SidebarItem,
  sidebarPreset,
  type UsageMode,
} from "@printrio/shared";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Dialog, Field, FormError, PageHeader } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { groupsQuery, settingsQuery, usersQuery, useUpdateSettings } from "../lib/queries.ts";
import { meQuery } from "../lib/session.ts";
import { setTheme, type ThemePreference, useTheme } from "../lib/theme.ts";

export const SETTINGS_TABS = ["general", "sidebar", "appearance", "groups", "users"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
const ADMIN_TABS = new Set<SettingsTab>(["general", "sidebar", "groups", "users"]);

export function SettingsPage() {
  const t = useT();
  const { tab = "general" } = useSearch({ from: "/app/settings" });
  const { data: me } = useSuspenseQuery(meQuery);
  const isAdmin = me?.role === "admin";
  const tabs = SETTINGS_TABS.filter((id) => isAdmin || !ADMIN_TABS.has(id));
  const active = tabs.includes(tab) ? tab : "appearance";

  return (
    <main className="mx-auto max-w-4xl p-6 md:p-8">
      <PageHeader title={t("settings.title")} />
      {!isAdmin && <p className="mt-2 text-sm text-muted">{t("settings.adminOnly")}</p>}
      <nav
        className="mt-6 flex gap-1 overflow-x-auto border-line border-b"
        aria-label={t("settings.title")}
      >
        {tabs.map((id) => (
          <Link
            key={id}
            to="/settings"
            search={{ tab: id }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap ${
              active === id
                ? "border-accent font-semibold text-text"
                : "border-transparent text-muted hover:text-text"
            }`}
            aria-current={active === id ? "page" : undefined}
          >
            {t(`settings.tabs.${id}`)}
          </Link>
        ))}
      </nav>
      <div className="mt-6">
        {active === "general" && <GeneralSettings />}
        {active === "sidebar" && <SidebarSettings />}
        {active === "appearance" && <AppearanceSettings />}
        {active === "groups" && <GroupSettings />}
        {active === "users" && <UserSettings />}
      </div>
    </main>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card mb-4 p-5">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function RadioList<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid gap-2">
      {options.map(([optionValue, label]) => (
        <label key={optionValue} className="flex items-center gap-3 text-sm">
          <input
            type="radio"
            name={name}
            value={optionValue}
            checked={value === optionValue}
            onChange={() => onChange(optionValue)}
            className="accent-accent"
          />
          {label}
        </label>
      ))}
    </div>
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
        <RadioList<UsageMode>
          name="usageMode"
          value={settings.usageMode}
          options={[
            ["single", t("settings.usageSingle")],
            ["farm", t("settings.usageFarm")],
          ]}
          onChange={(usageMode) => update.mutate({ usageMode, sidebar: sidebarPreset(usageMode) })}
        />
      </Section>
      <Section title={t("settings.defaultView")}>
        <RadioList<DefaultView>
          name="defaultView"
          value={settings.defaultView}
          options={[
            ["auto", t("settings.defaultViewAuto")],
            ["fleet", t("settings.defaultViewFleet")],
            ["printer", t("settings.defaultViewPrinter")],
          ]}
          onChange={(defaultView) => update.mutate({ defaultView })}
        />
      </Section>
      <CostSettingsSection />
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

function SidebarSettings() {
  const t = useT();
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const update = useUpdateSettings();
  const [dragging, setDragging] = useState<NavItemId | null>(null);
  const items = settings.sidebar;
  const save = (sidebar: SidebarItem[]) => update.mutate({ sidebar });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [item] = next.splice(from, 1);
    if (item) next.splice(to, 0, item);
    save(next);
  };

  return (
    <Section title={t("settings.tabs.sidebar")} hint={t("settings.sidebarHint")}>
      <FormError error={update.error} />
      <ol className="grid gap-2">
        {items.map((item, index) => {
          const name = t(`nav.${item.id}`);
          return (
            <li
              key={item.id}
              draggable
              onDragStart={() => setDragging(item.id)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() =>
                dragging &&
                move(
                  items.findIndex((i) => i.id === dragging),
                  index,
                )
              }
              className={`flex items-center gap-3 rounded-[10px] border border-line bg-sidebar px-3 py-2 ${dragging === item.id ? "opacity-50" : ""}`}
            >
              <span aria-hidden="true" className="cursor-grab text-subtle select-none">
                ⠿
              </span>
              <label className="flex flex-1 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={item.visible}
                  onChange={(event) =>
                    save(
                      items.map((i) =>
                        i.id === item.id ? { ...i, visible: event.target.checked } : i,
                      ),
                    )
                  }
                  aria-label={t("settings.show", { name })}
                  className="accent-accent"
                />
                <span className={item.visible ? "" : "text-subtle"}>{name}</span>
              </label>
              <button
                type="button"
                className="btn btn-secondary btn-sm px-2"
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
                aria-label={t("settings.moveUp", { name })}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm px-2"
                disabled={index === items.length - 1}
                onClick={() => move(index, index + 1)}
                aria-label={t("settings.moveDown", { name })}
              >
                ↓
              </button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="btn btn-secondary btn-sm mt-4"
        onClick={() => save(sidebarPreset(settings.usageMode))}
      >
        {t("settings.resetSidebar")}
      </button>
    </Section>
  );
}

function AppearanceSettings() {
  const t = useT();
  const theme = useTheme();
  return (
    <Section title={t("settings.theme")} hint={t("settings.themeHint")}>
      <RadioList<ThemePreference>
        name="theme"
        value={theme}
        options={[
          ["system", t("settings.themeSystem")],
          ["dark", t("settings.themeDark")],
          ["light", t("settings.themeLight")],
        ]}
        onChange={setTheme}
      />
    </Section>
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
    <Section title={t("settings.tabs.groups")} hint={t("settings.groupsHint")}>
      <FormError error={add.error ?? rename.error ?? remove.error} />
      <form
        className="mb-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) add.mutate(name.trim());
        }}
      >
        <input
          className="input"
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
            <li key={group.id} className="flex items-center gap-2">
              <input
                className="input"
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
        <p className="text-sm text-subtle">{t("settings.noGroups")}</p>
      )}
    </Section>
  );
}

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
    <Section title={t("settings.tabs.users")} hint={t("users.hint")}>
      <FormError error={update.error ?? remove.error} />
      <ul className="divide-y divide-line">
        {users.map((user) => (
          <li key={user.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
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
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={atLimit}
          onClick={() => setAdding(true)}
        >
          {t("users.add")}
        </button>
        {data?.limit !== null && data?.limit !== undefined && (
          <span className="text-xs text-subtle">
            {t("users.limit", { used: users.length, limit: data.limit })}
          </span>
        )}
      </div>

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
