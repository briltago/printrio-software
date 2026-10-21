import type { SsoSettingsDto } from "@printrio/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Field, FormError, Section } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";

const KEY = ["settings", "sso"];

/** Settings → Single sign-on: OpenID Connect provider (Business). */
export function SsoSettings() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data, error } = useQuery({
    queryKey: KEY,
    queryFn: () => api<SsoSettingsDto>("/api/settings/sso"),
  });
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (body: object) => api<SsoSettingsDto>("/api/settings/sso", { method: "PUT", body }),
    onSuccess: (next) => {
      queryClient.setQueryData(KEY, next);
      void queryClient.invalidateQueries({ queryKey: ["sso"] });
      setSaved(true);
    },
  });
  if (!data) return <FormError error={error} />;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const v = (name: string) => String(f.get(name) ?? "").trim();
    setSaved(false);
    save.mutate({
      enabled: f.get("enabled") === "on",
      issuer: v("issuer"),
      clientId: v("clientId"),
      clientSecret: v("clientSecret") || undefined,
      label: v("label") || "SSO",
      allowedDomains: v("allowedDomains")
        .split(/[\s,;]+/)
        .filter(Boolean),
      autoCreate: f.get("autoCreate") === "on",
      publicUrl: v("publicUrl"),
    });
  };

  return (
    <Section title={t("sso.title")} hint={t("sso.hint")}>
      {!data.available && (
        <p className="mb-4 rounded-[10px] border border-line p-3 text-sm text-muted">
          {t("sso.business")}
        </p>
      )}
      <form className="grid" onSubmit={submit} onChange={() => setSaved(false)}>
        <label className="mb-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={data.enabled}
            disabled={!data.available}
          />
          {t("sso.enabled")}
        </label>
        <Field
          label={t("sso.issuer")}
          name="issuer"
          type="url"
          defaultValue={data.issuer}
          placeholder="https://login.microsoftonline.com/<tenant>/v2.0"
        />
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label={t("sso.clientId")} name="clientId" defaultValue={data.clientId} />
          <Field
            label={t("sso.clientSecret")}
            name="clientSecret"
            type="password"
            required={false}
            placeholder={data.hasSecret ? t("sso.keepSecret") : ""}
          />
        </div>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field
            label={t("sso.label")}
            name="label"
            defaultValue={data.label}
            placeholder="Microsoft"
          />
          <Field
            label={t("sso.domains")}
            name="allowedDomains"
            required={false}
            defaultValue={data.allowedDomains.join(", ")}
            placeholder="example.com"
          />
        </div>
        <label className="mb-4 flex items-center gap-2 text-sm">
          <input type="checkbox" name="autoCreate" defaultChecked={data.autoCreate} />
          {t("sso.autoCreate")}
        </label>
        <Field
          label={t("sso.publicUrl")}
          name="publicUrl"
          type="url"
          required={false}
          defaultValue={data.publicUrl}
          hint={t("sso.publicUrlHint")}
        />
        <div className="mb-4 grid gap-1 text-sm">
          <span className="font-medium">{t("sso.redirect")}</span>
          <code className="break-all rounded-[8px] bg-surface-2 px-3 py-2 text-xs">
            {data.redirectUri}
          </code>
        </div>
        <FormError error={save.error} />
        <div className="flex items-center gap-3">
          <button type="submit" className="btn btn-primary btn-sm" disabled={save.isPending}>
            {t("common.save")}
          </button>
          {saved && <span className="text-sm text-success">{t("sso.saved")}</span>}
        </div>
      </form>
    </Section>
  );
}
