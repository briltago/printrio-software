import type { LicenceStatus } from "@printrio/shared";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { FormError, Section } from "../components.tsx";
import { currentLocale, useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { formatRelativeTime } from "../lib/format.ts";
import { modulesQuery } from "../lib/modules.tsx";
import { UpdateSection } from "./updates.tsx";

export const licenceQuery = queryOptions({
  queryKey: ["licence"],
  queryFn: () => api<LicenceStatus>("/api/licence"),
});

const PRICING_URL = "https://printrio.app/pricing";

/** Settings → Licence: plan, activation, subscription management. */
export function LicenceSettings() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: licence } = useQuery(licenceQuery);
  const { data: modules } = useQuery(modulesQuery);

  const onChanged = (status: LicenceStatus) => {
    queryClient.setQueryData(licenceQuery.queryKey, status);
    // Limits changed; modules load in the background (a realtime event follows).
    void queryClient.invalidateQueries({ queryKey: ["printers"] });
    void queryClient.invalidateQueries({ queryKey: ["users"] });
    void queryClient.invalidateQueries({ queryKey: modulesQuery.queryKey });
  };
  const refresh = useMutation({
    mutationFn: () => api<LicenceStatus>("/api/licence/refresh", { method: "POST" }),
    onSuccess: onChanged,
  });
  const deactivate = useMutation({
    mutationFn: () => api<LicenceStatus>("/api/licence/deactivate", { method: "POST" }),
    onSuccess: onChanged,
  });
  const portal = useMutation({
    mutationFn: () => api<{ url: string }>("/api/licence/portal", { method: "POST" }),
    onSuccess: ({ url }) => window.open(url, "_blank", "noopener"),
  });

  if (!licence) return <p className="text-sm text-muted">{t("common.loading")}</p>;
  const limit = (value: number | null) => (value === null ? t("licence.unlimited") : value);

  return (
    <>
      <Section
        title={t("licence.plan")}
        actions={
          licence.tier !== "business" ? (
            <a
              href={PRICING_URL}
              target="_blank"
              rel="noopener"
              className="btn btn-secondary btn-sm"
            >
              {t("licence.compare")} ↗
            </a>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-card bg-accent/15 text-lg text-accent">
            ✦
          </span>
          <div>
            <p className="text-2xl font-semibold tracking-tight">
              Printrio {t(`licence.tiers.${licence.tier}`)}
            </p>
            {licence.tier === "free" && !licence.activated && (
              <p className="text-sm text-muted">
                {t("licence.freeHint", {
                  printers: licence.limits.printers ?? "∞",
                  users: licence.limits.users ?? "∞",
                })}
              </p>
            )}
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-3">
          {(
            [
              [t("licence.printers"), licence.limits.printers],
              [t("licence.users"), licence.limits.users],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-card border border-line bg-surface-2 px-4 py-3">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums">{limit(value)}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {!licence.activated ? (
        licence.available ? (
          <ActivateForm onActivated={onChanged} />
        ) : (
          <Section title={t("licence.key")}>
            <p className="text-sm text-muted">{t("licence.unavailable")}</p>
          </Section>
        )
      ) : (
        <Section title={t("licence.key")}>
          <p className="mb-4 inline-block rounded-[7px] border border-line bg-surface-2 px-3 py-1.5 font-mono text-sm tracking-wide">
            {licence.licenceKey}
          </p>
          {licence.lastError && (
            <p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
              {t("licence.problem", { error: licence.lastError })}
            </p>
          )}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            {licence.email && (
              <>
                <dt className="text-muted">{t("licence.account")}</dt>
                <dd className="min-w-0 truncate">{licence.email}</dd>
              </>
            )}
            <dt className="text-muted">{t("licence.validUntil")}</dt>
            <dd>
              {licence.validUntil
                ? new Date(licence.validUntil).toLocaleDateString(currentLocale())
                : t("licence.renews")}
            </dd>
            <dt className="text-muted">{t("licence.leaseUntil")}</dt>
            <dd>
              {licence.leaseExpiresAt
                ? new Date(licence.leaseExpiresAt).toLocaleString(currentLocale())
                : "—"}
            </dd>
            <dt className="text-muted">{t("licence.lastCheck")}</dt>
            <dd>
              {licence.lastRefreshAt
                ? formatRelativeTime(licence.lastRefreshAt)
                : t("licence.never")}
            </dd>
          </dl>
          <FormError error={refresh.error ?? deactivate.error ?? portal.error} />
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              {t("licence.checkNow")}
            </button>
            {licence.managed && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={portal.isPending}
                onClick={() => portal.mutate()}
              >
                {t("licence.manage")} ↗
              </button>
            )}
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={deactivate.isPending}
              onClick={() => {
                if (window.confirm(t("licence.deactivateConfirm"))) deactivate.mutate();
              }}
            >
              {t("licence.deactivate")}
            </button>
          </div>
        </Section>
      )}

      {modules && modules.modules.length > 0 && (
        <Section title={t("licence.modules")}>
          <ul className="grid gap-2 text-sm">
            {modules.modules.map((module) => (
              <li
                key={module.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[7px] border border-line bg-surface-2 px-3 py-2"
              >
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full ${module.error ? "bg-danger" : "bg-success"}`}
                />
                <span className="font-medium capitalize">{module.id}</span>
                <span className="text-muted">{module.version}</span>
                {module.error && (
                  <span className="text-danger">
                    {t("licence.moduleError", { error: module.error })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <UpdateSection />
      <p className="mt-2 text-xs text-subtle">
        {t("licence.instance")}: <code>{licence.instanceId}</code>
      </p>
    </>
  );
}

function ActivateForm({ onActivated }: { onActivated: (status: LicenceStatus) => void }) {
  const t = useT();
  const [key, setKey] = useState("");
  const activate = useMutation({
    mutationFn: (licenceKey: string) =>
      api<LicenceStatus>("/api/licence/activate", { method: "POST", body: { licenceKey } }),
    onSuccess: onActivated,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    activate.mutate(key);
  };
  return (
    <Section title={t("licence.key")} hint={t("licence.keyHint")}>
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <input
          name="licenceKey"
          aria-label={t("licence.key")}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="PRIO-XXXXX-XXXXX-XXXXX-XXXXX"
          autoComplete="off"
          spellCheck={false}
          required
          minLength={10}
          className="input min-w-0 flex-1 font-mono uppercase"
        />
        <button type="submit" className="btn btn-primary" disabled={activate.isPending}>
          {activate.isPending ? t("licence.activating") : t("licence.activate")}
        </button>
      </form>
      <FormError error={activate.error} />
    </Section>
  );
}
