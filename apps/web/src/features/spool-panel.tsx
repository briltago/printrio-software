import { isLowStock, lowStockThreshold } from "@printrio/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FormError } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { filamentLabel, formatGrams, inventoryQuery, remainingShare } from "../lib/filament.ts";
import { printersQuery, settingsQuery } from "../lib/queries.ts";
import { Swatch } from "./filament-forms.tsx";
import { Panel } from "./panel.tsx";

/** The spool loaded in a printer (manual assignment) and a quick way to swap it. */
export function SpoolPanel({
  printerId,
  activeSpoolId,
}: {
  printerId: string;
  activeSpoolId: string | null;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const inventory = useQuery(inventoryQuery);
  const { data: settings } = useQuery(settingsQuery);
  const assign = useMutation({
    mutationFn: (spoolId: string | null) =>
      api(`/api/printers/${printerId}/spool`, { method: "PUT", body: { spoolId } }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: printersQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: inventoryQuery.queryKey }),
      ]),
  });

  const filaments = new Map((inventory.data?.filaments ?? []).map((f) => [f.id, f]));
  const spools = (inventory.data?.spools ?? []).filter((s) => !s.archived);
  const active = spools.find((s) => s.id === activeSpoolId);
  const activeFilament = active && filaments.get(active.filamentId);
  const low =
    active && settings ? isLowStock(active, lowStockThreshold(settings.inventory)) : false;
  const label = (spoolId: string) => {
    const spool = spools.find((s) => s.id === spoolId);
    const filament = spool && filaments.get(spool.filamentId);
    if (!spool || !filament) return "?";
    return [filamentLabel(filament), filament.colorName, formatGrams(spool.remainingWeight)]
      .filter(Boolean)
      .join(" · ");
  };

  return (
    <Panel id="spool" title={t("spool.title")}>
      <FormError error={assign.error} />
      {active && activeFilament ? (
        <div className="flex items-center gap-3">
          <Swatch color={activeFilament.colorHex} size={32} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-semibold">
              <span className="truncate">{filamentLabel(activeFilament)}</span>
              {low && <span className="badge state-paused shrink-0">{t("filament.lowStock")}</span>}
            </p>
            <p className="text-xs text-subtle tabular-nums">
              {[
                activeFilament.colorName,
                t("spool.remaining", {
                  weight: formatGrams(active.remainingWeight),
                  percent: Math.round(remainingShare(active) * 100),
                }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">{t("spool.none")}</p>
      )}
      {spools.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            className="input min-w-0 flex-1 py-1.5 text-sm"
            aria-label={t("spool.change")}
            value={active?.id ?? ""}
            disabled={assign.isPending}
            onChange={(event) => assign.mutate(event.target.value || null)}
          >
            <option value="">{t("spool.noneOption")}</option>
            {spools.map((spool) => (
              <option key={spool.id} value={spool.id}>
                {label(spool.id)}
              </option>
            ))}
          </select>
        </div>
      ) : (
        inventory.data && (
          <p className="mt-2 text-sm">
            <Link to="/filament" className="text-accent hover:underline">
              {t("spool.addSpools")}
            </Link>
          </p>
        )
      )}
    </Panel>
  );
}
