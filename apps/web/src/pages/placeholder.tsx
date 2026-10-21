import type { NavItemId } from "@printrio/shared";
import { EmptyState, PageHeader } from "../components.tsx";
import { useT } from "../i18n/index.tsx";

/** Sections on the roadmap (jobs, files, filament, costs, orders) render this until they ship. */
export function PlaceholderPage({ section }: { section: NavItemId }) {
  const t = useT();
  return (
    <main className="mx-auto max-w-6xl px-4 py-5 sm:p-6 md:p-8">
      <PageHeader title={t(`nav.${section}`)} />
      <EmptyState title={t("common.comingSoon")} text={t("placeholder.text")} />
    </main>
  );
}
