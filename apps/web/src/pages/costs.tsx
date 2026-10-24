import type { CostSummaryDto, CostTotals } from "@printrio/shared";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, FormError, PageHeader } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { formatDuration, formatMoney, formatWeight } from "../lib/format.ts";
import { type CostPeriod, periodStart } from "../lib/jobs.ts";
import { useStoredState } from "../lib/stored-state.ts";
import { JobsTabs } from "./jobs.tsx";

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
    <main className="page">
      <PageHeader
        title={t("nav.costs")}
        subtitle={t("costs.subtitle")}
        actions={
          <fieldset className="seg">
            <legend className="sr-only">{t("costs.period")}</legend>
            {PERIODS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={period === id}
                onClick={() => setPeriod(id)}
              >
                {t(`costs.periods.${id}`)}
              </button>
            ))}
          </fieldset>
        }
      />
      <JobsTabs current="costs" />
      <div className="mt-5">
        <FormError error={summary.error} />
        {data && data.totals.jobs === 0 ? (
          <EmptyState title={t("costs.emptyTitle")} text={t("costs.emptyText")} />
        ) : (
          data && (
            <>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line md:grid-cols-3 xl:grid-cols-6">
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
    <div className="bg-surface px-4 py-3">
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
    <section className="card px-4 pt-4 pb-1" aria-label={title}>
      <h2 className="mb-3 text-[15px] font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="pb-3 text-sm text-subtle">—</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t("costs.name")}</th>
              <th scope="col" className="text-right">
                {t("costs.prints")}
              </th>
              <th scope="col" className="hidden text-right sm:table-cell">
                {t("costs.filament")}
              </th>
              <th scope="col" className="text-right">
                {t("costs.total")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="w-full max-w-0 truncate">{row.name}</td>
                <td className="text-right tabular-nums">{row.jobs}</td>
                <td className="hidden text-right tabular-nums sm:table-cell">
                  {formatWeight(row.filamentGrams)}
                </td>
                <td className="text-right font-semibold tabular-nums">{money(row.totalCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
