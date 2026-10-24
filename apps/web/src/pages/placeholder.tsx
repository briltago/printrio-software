import type { NavItemId } from "@printrio/shared";
import { EmptyState, PageHeader } from "../components.tsx";
import { useT } from "../i18n/index.tsx";

/** Sections on the roadmap (jobs, files, filament, costs, orders) render this until they ship. */
export function PlaceholderPage({ section }: { section: NavItemId }) {
  const t = useT();
  return (
    <main className="page">
      <PageHeader title={t(`nav.${section}`)} />
      <EmptyState title={t("common.comingSoon")} text={t("placeholder.text")} />
    </main>
  );
}
