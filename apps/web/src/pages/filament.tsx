import type { FilamentDto, SpoolDto } from "@printrio/shared";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Dialog, EmptyState, FormError, PageHeader } from "../components.tsx";
import {
  FilamentForm,
  SpoolForm,
  SpoolmanImportForm,
  Swatch,
  WeighForm,
} from "../features/filament-forms.tsx";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons.tsx";
import { api } from "../lib/api.ts";
import {
  filamentLabel,
  formatGrams,
  gramsToMetres,
  inventoryQuery,
  LOW_STOCK_SHARE,
  remainingShare,
} from "../lib/filament.ts";
import { printersQuery } from "../lib/queries.ts";
import { meQuery } from "../lib/session.ts";
import { useStoredState } from "../lib/stored-state.ts";

type DialogState =
  | { kind: "spool"; spool?: SpoolDto }
  | { kind: "filament"; filament?: FilamentDto }
  | { kind: "weigh"; spool: SpoolDto }
  | { kind: "import" }
  | null;

/** Filament inventory: spools (physical rolls) and the filament products they belong to. */
export function FilamentPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: me } = useSuspenseQuery(meQuery);
  const isAdmin = me?.role === "admin";
  const inventory = useQuery(inventoryQuery);
  const { data: printerData } = useQuery(printersQuery);
  const [tab, setTab] = useStoredState<"spools" | "filaments">("printrio-filament-tab", "spools");
  const [search, setSearch] = useState("");
  const [material, setMaterial] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [lowOnly, setLowOnly] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: inventoryQuery.queryKey }),
      queryClient.invalidateQueries({ queryKey: printersQuery.queryKey }),
    ]);
  const mutate = useMutation({
    mutationFn: ({ path, method, body }: { path: string; method: string; body?: unknown }) =>
      api(path, { method, body }),
    onSuccess: invalidate,
  });

  const filaments = inventory.data?.filaments ?? [];
  const spools = inventory.data?.spools ?? [];
  const byId = new Map(filaments.map((f) => [f.id, f]));
  const printerName = new Map((printerData?.printers ?? []).map((p) => [p.id, p.name]));
  const materials = [...new Set(filaments.map((f) => f.material))].sort();
  const query = search.trim().toLowerCase();
  const visibleSpools = spools
    .filter((spool) => showArchived || !spool.archived)
    .filter(
      (spool) =>
        !lowOnly || lowCount === 0 || (!spool.archived && remainingShare(spool) < LOW_STOCK_SHARE),
    )
    .filter((spool) => {
      const filament = byId.get(spool.filamentId);
      if (!filament) return false;
      if (material && filament.material !== material) return false;
      if (!query) return true;
      return [filamentLabel(filament), filament.colorName, spool.location, spool.lot]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    })
    .sort(
      (a, b) => Number(a.archived) - Number(b.archived) || remainingShare(a) - remainingShare(b),
    );
  const lowCount = spools.filter(
    (spool) => !spool.archived && remainingShare(spool) < LOW_STOCK_SHARE,
  ).length;
  const totalGrams = spools
    .filter((spool) => !spool.archived)
    .reduce((sum, spool) => sum + spool.remainingWeight, 0);

  const dialogTitle =
    dialog?.kind === "spool"
      ? t(dialog.spool ? "filament.editSpool" : "filament.newSpool")
      : dialog?.kind === "filament"
        ? t(dialog.filament ? "filament.editFilament" : "filament.newFilament")
        : dialog?.kind === "weigh"
          ? t("filament.weigh")
          : t("filament.importTitle");

  return (
    <main className="page">
      <PageHeader
        title={t("nav.filament")}
        subtitle={
          inventory.data &&
          t("filament.summary", {
            spools: spools.filter((s) => !s.archived).length,
            weight: formatGrams(totalGrams),
          })
        }
        actions={
          <>
            {isAdmin && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDialog({ kind: "import" })}
              >
                {t("filament.importSpoolman")}
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setDialog(tab === "spools" ? { kind: "spool" } : { kind: "filament" })}
            >
              {tab === "spools" ? t("filament.newSpool") : t("filament.newFilament")}
            </button>
          </>
        }
      />
      <nav className="tabs mt-5" aria-label={t("nav.filament")}>
        {(["spools", "filaments"] as const).map((id) => (
          <button
            key={id}
            type="button"
            className="tab"
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {t(`filament.tabs.${id}`)}
          </button>
        ))}
      </nav>
      <div className="mt-5">
        <FormError error={inventory.error ?? mutate.error} />
        {tab === "spools" ? (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <input
                type="search"
                className="input w-full sm:w-64"
                placeholder={t("filament.search")}
                aria-label={t("filament.search")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <select
                className="input w-auto"
                aria-label={t("filament.material")}
                value={material}
                onChange={(event) => setMaterial(event.target.value)}
              >
                <option value="">{t("filament.allMaterials")}</option>
                {materials.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              {(lowCount > 0 || lowOnly) && (
                <button
                  type="button"
                  className="btn btn-secondary aria-pressed:border-warning aria-pressed:text-warning"
                  aria-pressed={lowOnly}
                  onClick={() => setLowOnly(!lowOnly)}
                >
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-warning" />
                  {t("filament.lowStock")}
                  <span className="tabular-nums text-subtle">{lowCount}</span>
                </button>
              )}
              <label className="flex min-h-9 items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(event) => setShowArchived(event.target.checked)}
                />
                {t("filament.showArchived")}
              </label>
            </div>
            {inventory.data && spools.length === 0 ? (
              <EmptyState
                title={t("filament.emptyTitle")}
                text={t("filament.emptyText")}
                action={
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setDialog({ kind: "spool" })}
                  >
                    {t("filament.newSpool")}
                  </button>
                }
              />
            ) : (
              visibleSpools.length > 0 && (
                <ul className="card divide-y divide-line">
                  {visibleSpools.map((spool) => {
                    const filament = byId.get(spool.filamentId);
                    if (!filament) return null;
                    const share = remainingShare(spool);
                    const low = !spool.archived && share < LOW_STOCK_SHARE;
                    return (
                      <li
                        key={spool.id}
                        className={`grid gap-x-6 gap-y-3 px-4 py-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto] md:items-center ${spool.archived ? "opacity-60" : ""}`}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <Swatch color={filament.colorHex} size={24} />
                          <div className="min-w-0">
                            <p className="truncate font-semibold" title={filamentLabel(filament)}>
                              {filamentLabel(filament)}
                            </p>
                            <p className="truncate text-xs text-subtle">
                              {[filament.colorName, `${filament.diameter} mm`, spool.lot]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-baseline justify-between gap-2 text-sm">
                            <span
                              className={`font-semibold tabular-nums ${low ? "text-warning" : ""}`}
                            >
                              {formatGrams(spool.remainingWeight)}
                              {low && <span className="sr-only"> ({t("filament.lowStock")})</span>}
                            </span>
                            <span className="truncate text-xs text-subtle tabular-nums">
                              {t("filament.ofWeight", {
                                weight: formatGrams(spool.initialWeight),
                                metres: Math.round(
                                  gramsToMetres(
                                    spool.remainingWeight,
                                    filament.diameter,
                                    filament.density,
                                  ),
                                ),
                              })}
                            </span>
                          </div>
                          <div
                            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line"
                            role="progressbar"
                            aria-label={t("filament.remainingWeight")}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(share * 100)}
                          >
                            <div
                              className={`h-full rounded-full ${low ? "bg-warning" : "bg-success"}`}
                              style={{ width: `${share * 100}%` }}
                            />
                          </div>
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                          {spool.printerIds.length > 0 && (
                            <span className="badge state-printing max-w-full">
                              <span className="truncate">
                                {t("filament.loadedIn", {
                                  printers: spool.printerIds
                                    .map((id) => printerName.get(id) ?? "?")
                                    .join(", "),
                                })}
                              </span>
                            </span>
                          )}
                          {spool.location && (
                            <span className="truncate text-muted">{spool.location}</span>
                          )}
                          {spool.archived && (
                            <span className="badge state-offline">{t("filament.archived")}</span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5 md:justify-end">
                          {!spool.archived && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => setDialog({ kind: "weigh", spool })}
                            >
                              {t("filament.weigh")}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setDialog({ kind: "spool", spool })}
                          >
                            {t("common.edit")}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() =>
                              mutate.mutate({
                                path: `/api/spools/${spool.id}`,
                                method: "PATCH",
                                body: { archived: !spool.archived },
                              })
                            }
                          >
                            {spool.archived ? t("filament.restore") : t("filament.archive")}
                          </button>
                          {isAdmin && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm px-2"
                              aria-label={t("filament.deleteSpool")}
                              title={t("filament.deleteSpool")}
                              onClick={() =>
                                window.confirm(t("filament.deleteSpoolConfirm")) &&
                                mutate.mutate({ path: `/api/spools/${spool.id}`, method: "DELETE" })
                              }
                            >
                              <Icon name="close" size={14} />
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )
            )}
            {inventory.data && spools.length > 0 && visibleSpools.length === 0 && (
              <p className="text-sm text-muted">{t("filament.noMatch")}</p>
            )}
          </>
        ) : (
          <FilamentTable
            filaments={filaments}
            isAdmin={isAdmin}
            onEdit={(filament) => setDialog({ kind: "filament", filament })}
            onDelete={(filament) =>
              window.confirm(
                t("filament.deleteFilamentConfirm", { name: filamentLabel(filament) }),
              ) && mutate.mutate({ path: `/api/filaments/${filament.id}`, method: "DELETE" })
            }
          />
        )}
      </div>

      <Dialog open={dialog !== null} onClose={() => setDialog(null)} title={dialogTitle}>
        {dialog?.kind === "spool" && (
          <SpoolForm spool={dialog.spool} filaments={filaments} onDone={() => setDialog(null)} />
        )}
        {dialog?.kind === "filament" && (
          <FilamentForm filament={dialog.filament} onDone={() => setDialog(null)} />
        )}
        {dialog?.kind === "weigh" && (
          <WeighForm spool={dialog.spool} onDone={() => setDialog(null)} />
        )}
        {dialog?.kind === "import" && <SpoolmanImportForm onDone={() => setDialog(null)} />}
      </Dialog>
    </main>
  );
}

function FilamentTable({
  filaments,
  isAdmin,
  onEdit,
  onDelete,
}: {
  filaments: FilamentDto[];
  isAdmin: boolean;
  onEdit: (filament: FilamentDto) => void;
  onDelete: (filament: FilamentDto) => void;
}) {
  const t = useT();
  if (filaments.length === 0)
    return <EmptyState title={t("filament.noFilaments")} text={t("filament.noFilamentsText")} />;
  return (
    <div className="card overflow-x-auto px-4 pt-3 pb-1">
      <table className="table">
        <thead>
          <tr>
            <th scope="col" className="w-8" />
            <th scope="col">{t("filament.filament")}</th>
            <th scope="col">{t("filament.material")}</th>
            <th scope="col" className="hidden sm:table-cell">
              {t("filament.diameter")}
            </th>
            <th scope="col" className="hidden md:table-cell">
              {t("filament.price")}
            </th>
            <th scope="col">{t("filament.tabs.spools")}</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {filaments.map((filament) => (
            <tr key={filament.id}>
              <td>
                <Swatch color={filament.colorHex} />
              </td>
              <td className="w-full max-w-0">
                <p className="truncate font-medium">{filamentLabel(filament)}</p>
                {filament.colorName && (
                  <p className="truncate text-xs text-subtle">{filament.colorName}</p>
                )}
              </td>
              <td>{filament.material}</td>
              <td className="hidden tabular-nums sm:table-cell">{filament.diameter} mm</td>
              <td className="hidden tabular-nums md:table-cell">{filament.price ?? "—"}</td>
              <td className="tabular-nums">{filament.spoolCount}</td>
              <td>
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onEdit(filament)}
                  >
                    {t("common.edit")}
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm px-2"
                      aria-label={t("filament.deleteFilament")}
                      title={t("filament.deleteFilament")}
                      onClick={() => onDelete(filament)}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
