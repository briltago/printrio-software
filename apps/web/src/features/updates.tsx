import type { UpdateInfoDto } from "@printrio/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Section } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";

const DISMISSED = "printrio-update-dismissed";

export const updateQuery = {
  queryKey: ["system", "update"],
  queryFn: () => api<UpdateInfoDto>("/api/system/update"),
  staleTime: 3_600_000,
  retry: false,
};

/** Admins: a slim bar when a newer Printrio is released (hidden per version once closed). */
export function UpdateBanner({ admin }: { admin: boolean }) {
  const t = useT();
  const { data } = useQuery({ ...updateQuery, enabled: admin });
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED);
    } catch {
      return null;
    }
  });
  if (!data?.updateAvailable || !data.latest || dismissed === data.latest.version) return null;
  const close = () => {
    try {
      localStorage.setItem(DISMISSED, data.latest?.version ?? "");
    } catch {}
    setDismissed(data.latest?.version ?? null);
  };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-accent/30 border-b bg-accent/10 px-4 py-2 text-sm md:px-6">
      <span className="font-semibold">
        {t("release.available", { version: data.latest.version })}
      </span>
      <span className="text-muted">{t("release.running", { version: data.current })}</span>
      <a
        className="text-accent-2 hover:underline"
        href={data.latest.url}
        target="_blank"
        rel="noreferrer"
      >
        {t("release.notes")}
      </a>
      <Link to="/settings" search={{ tab: "licence" }} className="text-accent-2 hover:underline">
        {t("release.how")}
      </Link>
      <button
        type="button"
        className="icon-btn ml-auto -my-2"
        aria-label={t("release.dismiss")}
        onClick={close}
      >
        ✕
      </button>
    </div>
  );
}

/** Settings → Licence: version, newest release and how to update. */
export function UpdateSection() {
  const t = useT();
  const { data, error } = useQuery(updateQuery);
  return (
    <Section title={t("release.title")} hint={t("release.hint")}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted">{t("release.current")}</dt>
        <dd className="font-mono">{data?.current ?? "…"}</dd>
        <dt className="text-muted">{t("release.latest")}</dt>
        <dd>
          {error || (data && !data.checking) ? (
            t("release.notChecking")
          ) : data?.latest ? (
            <>
              <a
                className="font-mono text-accent-2 hover:underline"
                href={data.latest.url}
                target="_blank"
                rel="noreferrer"
              >
                {data.latest.version}
              </a>{" "}
              <span className={data.updateAvailable ? "text-warning" : "text-success"}>
                · {data.updateAvailable ? t("release.newer") : t("release.upToDate")}
              </span>
            </>
          ) : data ? (
            t("release.unknown")
          ) : (
            "…"
          )}
        </dd>
      </dl>
      <p className="mt-5 mb-2 text-sm text-muted">{t("release.howTo")}</p>
      <pre className="overflow-x-auto rounded-[10px] border border-line bg-sidebar p-3 font-mono text-xs">
        docker compose pull{"\n"}docker compose up -d
      </pre>
      <p className="mt-2 text-xs text-subtle">{t("release.backupNote")}</p>
    </Section>
  );
}
