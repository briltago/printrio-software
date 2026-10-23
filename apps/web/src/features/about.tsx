import { queryOptions, useQuery } from "@tanstack/react-query";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";

export const aboutQuery = queryOptions({
  queryKey: ["about"],
  queryFn: () => api<{ version: string; sourceUrl: string; license: string }>("/api/about"),
  staleTime: Number.POSITIVE_INFINITY,
});

/** Version, licence and a link to the source code of this version (AGPL section 13). */
export function AboutLine({ className = "" }: { className?: string }) {
  const t = useT();
  const { data } = useQuery(aboutQuery);
  if (!data) return null;
  return (
    <p className={`text-[11px] leading-relaxed text-subtle ${className}`}>
      {t("about.line", { version: data.version })}{" "}
      <a
        className="underline hover:text-text"
        href={data.sourceUrl}
        target="_blank"
        rel="noreferrer"
      >
        {t("about.source")}
      </a>
      {" · "}
      <a
        className="underline hover:text-text"
        href="/third-party-licenses.md"
        target="_blank"
        rel="noreferrer"
      >
        {t("about.licences")}
      </a>
    </p>
  );
}
