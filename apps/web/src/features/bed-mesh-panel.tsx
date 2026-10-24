import type { BedMeshActionDto, BedMeshDto } from "@printrio/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { EmptyState, FormError } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import {
  divergingColor,
  divergingExtent,
  formatMm,
  gridCoordinate,
  meshStats,
} from "../lib/mesh.ts";
import { useStoredState } from "../lib/stored-state.ts";

type Source = "probed" | "mesh";
type View = "map" | "table";

/** Bed mesh: heatmap of the active mesh, profiles, calibration. */
export function BedMeshPanel({
  printerId,
  busy,
  isAdmin,
}: {
  printerId: string;
  busy: boolean;
  isAdmin: boolean;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const queryKey = ["bed-mesh", printerId];
  const [source, setSource] = useStoredState<Source>("printrio-mesh-source", "mesh");
  const [view, setView] = useStoredState<View>("printrio-mesh-view", "map");
  const mesh = useQuery({
    queryKey,
    queryFn: () => api<{ mesh: BedMeshDto | null }>(`/api/printers/${printerId}/bed-mesh`),
    // Saving a profile restarts Klipper; the mesh is unavailable for a few seconds.
    retry: 5,
    retryDelay: 1500,
  });
  const action = useMutation({
    mutationFn: (body: BedMeshActionDto) =>
      api(`/api/printers/${printerId}/bed-mesh`, { method: "POST", body }),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  if (mesh.isPending) return <p className="text-sm text-muted">{t("config.loading")}</p>;
  if (!mesh.data) return <FormError error={mesh.error} />;
  const data = mesh.data.mesh;
  if (!data) return <EmptyState title={t("mesh.none")} text={t("mesh.noneText")} />;

  const matrix = source === "probed" ? data.probed : data.mesh.length ? data.mesh : data.probed;
  const pending = action.isPending ? action.variables?.op : null;
  const run = (body: BedMeshActionDto, confirm?: string) => {
    if (!confirm || window.confirm(confirm)) action.mutate(body);
  };
  const saveAs = () => {
    const name = window.prompt(t("mesh.savePrompt"), data.activeProfile ?? "default")?.trim();
    if (!name) return;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
      window.alert(t("mesh.invalidName"));
      return;
    }
    run({ op: "save", profile: name }, t("mesh.saveConfirm", { name }));
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <section className="card min-w-0 p-5" aria-label={t("mesh.title")}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-40 flex-1">
            <h2 className="text-sm font-semibold">{t("mesh.title")}</h2>
            <p className="text-xs text-subtle">
              {data.activeProfile
                ? t("mesh.activeProfile", { name: data.activeProfile })
                : t("mesh.noActive")}
            </p>
          </div>
          {matrix.length > 0 && (
            <>
              <Segmented
                label={t("mesh.source")}
                value={source}
                options={[
                  ["mesh", t("mesh.interpolated")],
                  ["probed", t("mesh.probed")],
                ]}
                onChange={setSource}
              />
              <Segmented
                label={t("mesh.view")}
                value={view}
                options={[
                  ["map", t("mesh.map")],
                  ["table", t("mesh.table")],
                ]}
                onChange={setView}
              />
            </>
          )}
        </div>
        {matrix.length === 0 ? (
          <p className="mt-6 text-sm text-muted">{t("mesh.emptyText")}</p>
        ) : view === "map" ? (
          <Heatmap matrix={matrix} min={data.min} max={data.max} />
        ) : (
          <MeshTable matrix={matrix} min={data.min} max={data.max} />
        )}
      </section>

      <div className="grid content-start gap-4">
        <section className="card p-5" aria-label={t("mesh.actions")}>
          <h2 className="text-sm font-semibold">{t("mesh.actions")}</h2>
          {busy && <p className="mt-2 text-sm text-warning">{t("mesh.busy")}</p>}
          <FormError error={action.error} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy || action.isPending}
              onClick={() => run({ op: "calibrate" }, t("mesh.calibrateConfirm"))}
            >
              {pending === "calibrate" ? t("mesh.calibrating") : t("mesh.calibrate")}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy || action.isPending || !data.activeProfile}
              onClick={() => run({ op: "clear" })}
            >
              {t("mesh.clear")}
            </button>
            {isAdmin && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy || action.isPending || data.probed.length === 0}
                onClick={saveAs}
              >
                {t("mesh.saveAs")}
              </button>
            )}
          </div>
          <p className="mt-3 text-xs text-subtle">{t("mesh.hint")}</p>
        </section>

        <section className="card p-5" aria-label={t("mesh.profiles")}>
          <h2 className="text-sm font-semibold">{t("mesh.profiles")}</h2>
          {data.profiles.length === 0 && (
            <p className="mt-2 text-sm text-subtle">{t("mesh.noProfiles")}</p>
          )}
          <ul className="mt-3 grid gap-2">
            {data.profiles.map((profile) => {
              const stats = meshStats(profile.points);
              const active = profile.name === data.activeProfile;
              return (
                <li
                  key={profile.name}
                  className="flex items-center gap-2 rounded-[7px] border border-line px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm">{profile.name}</p>
                    {stats && (
                      <p className="text-xs text-subtle">
                        {t("mesh.rangeShort", { value: stats.range.toFixed(3) })}
                      </p>
                    )}
                  </div>
                  {active ? (
                    <span className="badge state-idle">{t("mesh.active")}</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy || action.isPending}
                      onClick={() => run({ op: "load", profile: profile.name })}
                    >
                      {t("mesh.load")}
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm px-2"
                      aria-label={t("mesh.remove", { name: profile.name })}
                      disabled={busy || action.isPending}
                      onClick={() =>
                        run(
                          { op: "remove", profile: profile.name },
                          t("mesh.removeConfirm", { name: profile.name }),
                        )
                      }
                    >
                      ✕
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="seg">
      <legend className="sr-only">{label}</legend>
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          className="text-xs"
          onClick={() => onChange(id)}
        >
          {text}
        </button>
      ))}
    </fieldset>
  );
}

interface GridProps {
  matrix: number[][];
  min: [number, number] | null;
  max: [number, number] | null;
}

function Heatmap({ matrix, min, max }: GridProps) {
  const t = useT();
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);
  const stats = meshStats(matrix);
  const extent = divergingExtent(stats);
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  const [minX, minY] = min ?? [0, 0];
  const [maxX, maxY] = max ?? [cols - 1, rows - 1];
  const aspect = maxX > minX && maxY > minY ? (maxX - minX) / (maxY - minY) : cols / rows;
  const hovered = hover ? matrix[hover.row]?.[hover.col] : undefined;

  return (
    <>
      {stats && (
        <dl className="mt-5 grid grid-cols-3 gap-3">
          <Stat label={t("mesh.range")} value={`${stats.range.toFixed(3)} mm`} />
          <Stat label={t("mesh.lowest")} value={formatMm(stats.min)} />
          <Stat label={t("mesh.highest")} value={formatMm(stats.max)} />
        </dl>
      )}
      <div className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
        <div className="flex flex-col justify-between py-1 text-right text-[11px] text-subtle tabular-nums">
          <span>Y {Math.round(maxY)}</span>
          <span>{Math.round(minY)}</span>
        </div>
        <div className="relative mx-auto w-full max-w-[480px]" style={{ aspectRatio: aspect }}>
          <div
            className="grid h-full w-full gap-[2px]"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            }}
            role="img"
            aria-label={t("mesh.mapLabel", {
              range: stats ? stats.range.toFixed(3) : "—",
            })}
            onPointerLeave={() => setHover(null)}
          >
            {/* Rows are stored from min Y; draw max Y on top like a top-down view of the bed. */}
            {[...matrix].reverse().map((values, reversedRow) => {
              const row = rows - 1 - reversedRow;
              return values.map((z, col) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: grid cells are positional.
                  key={`${row}-${col}`}
                  className={`rounded-[3px] ${hover?.row === row && hover.col === col ? "ring-2 ring-text" : ""}`}
                  style={{ background: divergingColor(z, extent) }}
                  onPointerEnter={() => setHover({ row, col })}
                />
              ));
            })}
          </div>
          {hover && hovered !== undefined && (
            <div
              className="pointer-events-none absolute z-10 whitespace-nowrap rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-xs shadow-xl"
              style={{
                left: `${((hover.col + 0.5) / cols) * 100}%`,
                top: `${((rows - hover.row - 0.5) / rows) * 100}%`,
                transform: `translate(${hover.col > cols / 2 ? "-110%" : "10%"}, -50%)`,
              }}
            >
              <p className="font-semibold tabular-nums">{formatMm(hovered)}</p>
              <p className="text-subtle tabular-nums">
                X {Math.round(gridCoordinate(hover.col, cols, minX, maxX))} · Y{" "}
                {Math.round(gridCoordinate(hover.row, rows, minY, maxY))} mm
              </p>
            </div>
          )}
        </div>
        <span />
        <div className="mx-auto flex w-full max-w-[480px] justify-between text-[11px] text-subtle tabular-nums">
          <span>X {Math.round(minX)}</span>
          <span>{Math.round(maxX)}</span>
        </div>
      </div>
      <div className="mx-auto mt-5 w-full max-w-[480px]">
        <div
          className="h-2 rounded-full"
          aria-hidden="true"
          style={{
            background:
              "linear-gradient(to right in oklab, var(--color-diverging-low), var(--color-diverging-mid), var(--color-diverging-high))",
          }}
        />
        <div className="mt-1 flex justify-between text-[11px] text-subtle tabular-nums">
          <span>
            {formatMm(-extent)} · {t("mesh.low")}
          </span>
          <span>0</span>
          <span>
            {t("mesh.high")} · {formatMm(extent)}
          </span>
        </div>
      </div>
    </>
  );
}

function MeshTable({ matrix, min, max }: GridProps) {
  const t = useT();
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  const [minX, minY] = min ?? [0, 0];
  const [maxX, maxY] = max ?? [cols - 1, rows - 1];
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full text-right font-mono text-xs tabular-nums">
        <caption className="sr-only">{t("mesh.tableCaption")}</caption>
        <thead className="text-subtle">
          <tr>
            <th scope="col" className="px-2 py-1 text-left font-normal">
              Y \ X
            </th>
            {matrix[0]?.map((_, col) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional.
              <th key={col} scope="col" className="px-2 py-1 font-normal">
                {Math.round(gridCoordinate(col, cols, minX, maxX))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...matrix].reverse().map((values, reversedRow) => {
            const row = rows - 1 - reversedRow;
            return (
              <tr key={row} className="border-line border-t">
                <th scope="row" className="px-2 py-1 text-left font-normal text-subtle">
                  {Math.round(gridCoordinate(row, rows, minY, maxY))}
                </th>
                {values.map((z, col) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional.
                  <td key={col} className="px-2 py-1">
                    {z.toFixed(3)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[7px] border border-line px-3 py-2">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
