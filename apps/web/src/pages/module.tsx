import { useParams } from "@tanstack/react-router";
import { createElement, type FC } from "react";
import { EmptyState } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { useModules } from "../lib/modules.tsx";

/** A page contributed by a module (Pro, Business), at /m/<module>/<path>. */
export function ModulePage() {
  const t = useT();
  const { moduleId, _splat: path = "" } = useParams({ from: "/app/m/$moduleId/$" });
  const { pages, loading } = useModules();
  const page = pages.find(
    (entry) => entry.moduleId === moduleId && entry.path.replace(/^\/+/, "") === path,
  );
  if (page) return createElement(page.component as FC);
  return (
    <main className="mx-auto max-w-4xl p-6 md:p-8">
      {loading ? (
        <p className="text-sm text-muted">{t("common.loading")}</p>
      ) : (
        <EmptyState title={t("modules.notFound")} text={t("modules.notFoundHint")} />
      )}
    </main>
  );
}
