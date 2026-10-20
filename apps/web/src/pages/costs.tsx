import type { CostSummaryDto, CostTotals } from "@printrio/shared";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, FormError, PageHeader } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { formatDuration, formatMoney, formatWeight } from "../lib/format.ts";
import { type CostPeriod, periodStart } from "../lib/jobs.ts";
import { useStoredState } from "../lib/stored-state.ts";

const PERIODS: CostPeriod[] = ["month", "30d", "year", "all"];

/** What printing costs (Free: material + energy); prices, margins and profit are Pro. */
export function CostsPage() {
  const t = useT();
  const [period, setPeriod] = useStoredState<CostPeriod>("printrio-cost-period", "month");
  const from = periodStart(period);
  const summary = useQuery({
    queryKey: ["costs", period],
    queryFn: () =>
      api<CostSummaryDto>(
        `/api/costs${from ? `?from=${encodeURIComponent(from.toISOString())}` : ""}`,
      ),
  });
  const data = summary.data;
  const money = (value: number) => formatMoney(value, data?.currency ?? "EUR");

  return (
    <main className="mx-auto max-w-6xl p-6 md:p-8">
      <PageHeader
        title={t("nav.costs")}
        subtitle={t("costs.subtitle")}
        actions={
          <fieldset className="inline-flex rounded-[10px] border border-line bg-sidebar p-0.5">
            <legend className="sr-only">{t("costs.period")}</legend>
            {PERIODS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={period === id}
                className={`rounded-[8px] px-3 py-1.5 text-sm ${
                  period === id
                    ? "bg-surface-2 font-semibold text-text"
                    : "text-muted hover:text-text"
                }`}
                onClick={() => setPeriod(id)}
              >
                {t(`costs.periods.${id}`)}
              </button>
            ))}
          </fieldset>
        }
      />
      <div className="mt-6">
        <FormError error={summary.error} />
        {data && data.totals.jobs === 0 ? (
          <EmptyState title={t("costs.emptyTitle")} text={t("costs.emptyText")} />
        ) : (
          data && (
            <>
              <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Tile label={t("costs.total")} value={money(data.totals.totalCost)} strong />
                <Tile label={t("costs.material")} value={money(data.totals.materialCost)} />
                <Tile label={t("costs.energy")} value={money(data.totals.energyCost)} />
                <Tile label={t("costs.filament")} value={formatWeight(data.totals.filamentGrams)} />
                <Tile label={t("costs.prints")} value={String(data.totals.jobs)} />
                <Tile
                  label={t("costs.printTime")}
                  value={formatDuration(t, data.totals.printSeconds)}
                />
              </dl>
              {data.jobsWithoutSpool > 0 && (
                <p className="mt-3 text-sm text-warning">
                  {t("costs.withoutSpool", { count: data.jobsWithoutSpool })}
                </p>
              )}
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <Breakdown
                  title={t("costs.byPrinter")}
                  rows={data.byPrinter.map((row) => ({
                    key: row.printerId ?? row.printerName,
                    name: row.printerName,
                    ...row,
                  }))}
                  money={money}
                />
                <Breakdown
                  title={t("costs.byMaterial")}
                  rows={data.byMaterial.map((row) => ({
                    key: row.material,
                    name: row.material,
                    ...row,
                  }))}
                  money={money}
                />
              </div>
            </>
          )
        )}
      </div>
    </main>
  );
}

function Tile({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className={`card px-4 py-3 ${strong ? "border-accent/40" : ""}`}>
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className={`mt-1 font-semibold tabular-nums ${strong ? "text-xl" : "text-lg"}`}>
        {value}
      </dd>
    </div>
  );
}

function Breakdown({
  title,
  rows,
  money,
}: {
  title: string;
  rows: (CostTotals & { key: string; name: string })[];
  money: (value: number) => string;
}) {
  const t = useT();
  return (
    <section className="card p-5" aria-label={title}>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-subtle">—</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-subtle">
            <tr>
              <th scope="col" className="pb-2 text-left font-semibold">
                {t("costs.name")}
              </th>
              <th scope="col" className="pb-2 text-right font-semibold">
                {t("costs.prints")}
              </th>
              <th scope="col" className="hidden pb-2 text-right font-semibold sm:table-cell">
                {t("costs.filament")}
              </th>
              <th scope="col" className="pb-2 text-right font-semibold">
                {t("costs.total")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-line border-t">
                <td className="w-full max-w-0 truncate py-2 pr-2">{row.name}</td>
                <td className="py-2 text-right tabular-nums">{row.jobs}</td>
                <td className="hidden py-2 text-right tabular-nums sm:table-cell">
                  {formatWeight(row.filamentGrams)}
                </td>
                <td className="py-2 text-right font-semibold tabular-nums">
                  {money(row.totalCost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
