import type { Printer, PrinterGroup } from "@printrio/shared";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Dialog, EmptyState, PageHeader, ProgressBar, StateBadge } from "../components.tsx";
import { PrinterForm } from "../features/printer-form.tsx";
import { useT } from "../i18n/index.tsx";
import {
  countStates,
  filterPrinters,
  isFiltered,
  isKnownState,
  NO_FILTER,
  stateOptions,
} from "../lib/fleet.ts";
import { formatDuration, formatPercent, formatTemp, heaterName } from "../lib/format.ts";
import { groupsQuery, printersQuery } from "../lib/queries.ts";
import { meQuery } from "../lib/session.ts";
import { useStoredState } from "../lib/stored-state.ts";

type ViewMode = "cards" | "compact" | "list";

export function FleetPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const { data } = useSuspenseQuery(printersQuery);
  const { data: groupData } = useQuery(groupsQuery);
  const groups = groupData?.groups ?? [];
  const [view, setView] = useStoredState<ViewMode>("printrio-fleet-view", "cards");
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const [groupId, setGroupId] = useState("");
  const [tag, setTag] = useState("");
  const [adding, setAdding] = useState(false);
  const isAdmin = me?.role === "admin";

  const printers = data.printers;
  const tags = useMemo(() => [...new Set(printers.flatMap((p) => p.tags))].sort(), [printers]);
  const filter = { search, state, groupId, tag };
  const filtered = filterPrinters(printers, groups, filter);
  const counts = countStates(printers);
  const clearFilters = () => {
    setSearch(NO_FILTER.search);
    setState(NO_FILTER.state);
    setGroupId(NO_FILTER.groupId);
    setTag(NO_FILTER.tag);
  };
  const addButton = isAdmin && (
    <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
      {t("printer.add")}
    </button>
  );

  return (
    <main className="page">
      <PageHeader
        title={t("fleet.title")}
        subtitle={
          data.limit !== null
            ? t("fleet.limit", { used: printers.length, limit: data.limit })
            : undefined
        }
        actions={addButton}
      />

      {printers.length === 0 ? (
        <EmptyState title={t("fleet.empty")} text={t("fleet.emptyText")} action={addButton} />
      ) : (
        <>
          {/* Status with counts doubles as the filter: the fleet at a glance, one click to narrow it. */}
          <fieldset className="seg mt-5">
            <legend className="sr-only">{t("fleet.filterState")}</legend>
            <button type="button" aria-pressed={state === ""} onClick={() => setState("")}>
              {t("common.all")}
              <span className="tabular-nums text-subtle">{printers.length}</span>
            </button>
            {stateOptions(counts, state).map(({ state: s, count }) => (
              <button
                key={s}
                type="button"
                aria-pressed={state === s}
                onClick={() => setState(state === s ? "" : s)}
              >
                <span aria-hidden="true" className={`state-${s} h-2 w-2 rounded-full bg-current`} />
                {isKnownState(s) ? t(`printer.states.${s}`) : s}
                <span className="tabular-nums text-subtle">{count}</span>
              </button>
            ))}
          </fieldset>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="search"
              className="input w-full sm:max-w-60"
              placeholder={t("fleet.searchPlaceholder")}
              aria-label={t("fleet.searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {groups.length > 0 && (
              <Filter
                label={t("fleet.filterGroup")}
                value={groupId}
                onChange={setGroupId}
                options={groups.map((g) => [g.id, g.name])}
              />
            )}
            {tags.length > 0 && (
              <Filter
                label={t("fleet.filterTag")}
                value={tag}
                onChange={setTag}
                options={tags.map((x) => [x, x])}
              />
            )}
            <fieldset className="seg ml-auto">
              <legend className="sr-only">{t("fleet.view")}</legend>
              {(["cards", "compact", "list"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={view === mode}
                  onClick={() => setView(mode)}
                >
                  {t(`fleet.view${mode[0]?.toUpperCase()}${mode.slice(1)}` as "fleet.viewCards")}
                </button>
              ))}
            </fieldset>
          </div>

          {filtered.length === 0 ? (
            <div className="mt-10 text-center text-sm text-muted" role="status">
              <p>{t("fleet.noMatches")}</p>
              {isFiltered(filter) && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm mt-3"
                  onClick={clearFilters}
                >
                  {t("fleet.clearFilters")}
                </button>
              )}
            </div>
          ) : view === "list" ? (
            <ListView printers={filtered} groups={groups} />
          ) : (
            <div
              className={`mt-4 grid gap-3 ${view === "cards" ? "sm:grid-cols-2 xl:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6"}`}
            >
              {filtered.map((printer) =>
                view === "cards" ? (
                  <PrinterCard key={printer.id} printer={printer} groups={groups} />
                ) : (
                  <PrinterTile key={printer.id} printer={printer} />
                ),
              )}
            </div>
          )}
        </>
      )}

      <Dialog open={adding} onClose={() => setAdding(false)} title={t("printer.add")}>
        <PrinterForm
          onSaved={() => setAdding(false)}
          onCancel={() => setAdding(false)}
          submitLabel={t("printer.add")}
        />
      </Dialog>
    </main>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  const t = useT();
  return (
    <select
      className="input w-auto"
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">
        {label}: {t("common.all")}
      </option>
      {options.map(([optionValue, optionLabel]) => (
        <option key={optionValue} value={optionValue}>
          {optionLabel}
        </option>
      ))}
    </select>
  );
}

const groupName = (groups: PrinterGroup[], id: string | null) =>
  groups.find((g) => g.id === id)?.name;

function PrinterCard({ printer, groups }: { printer: Printer; groups: PrinterGroup[] }) {
  const t = useT();
  const { status } = printer;
  const meta = [groupName(groups, printer.groupId), ...printer.tags].filter(Boolean);
  return (
    <Link
      to="/printers/$printerId"
      params={{ printerId: printer.id }}
      className="card block p-4 transition-colors hover:border-line-strong"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{printer.name}</p>
          {meta.length > 0 && (
            <p className="mt-0.5 truncate text-xs text-subtle">{meta.join(" · ")}</p>
          )}
        </div>
        <StateBadge state={status.state} />
      </div>
      <div className="mt-4 min-h-[52px]">
        {status.job ? (
          <>
            <div className="mb-2 flex justify-between gap-3 text-sm">
              <span className="truncate text-muted">{status.job.fileName}</span>
              <span className="font-semibold tabular-nums">
                {formatPercent(status.job.progress)}
              </span>
            </div>
            <ProgressBar value={status.job.progress} label={t("printer.progress")} />
            <p className="mt-2 text-xs text-muted tabular-nums">
              {t("printer.remaining")}: {formatDuration(t, status.job.remainingSeconds)}
            </p>
          </>
        ) : (
          <p
            className={`text-sm ${status.state === "error" ? "text-danger" : "text-muted"} line-clamp-2`}
          >
            {status.message ?? t("printer.noJob")}
          </p>
        )}
      </div>
      {status.temperatures.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-line border-t pt-3 text-xs text-muted">
          {status.temperatures.slice(0, 3).map((temp) => (
            <span key={temp.name}>
              {heaterName(t, temp.name)}{" "}
              <span className="font-semibold text-text tabular-nums">
                {formatTemp(temp.current)}
              </span>
            </span>
          ))}
        </div>
      )}
      {!printer.withinLimit && (
        <p className="mt-3 text-xs text-warning">{t("printer.outsideLimit")}</p>
      )}
    </Link>
  );
}

function PrinterTile({ printer }: { printer: Printer }) {
  const t = useT();
  const { status } = printer;
  return (
    <Link
      to="/printers/$printerId"
      params={{ printerId: printer.id }}
      className="card block p-3 transition-colors hover:border-line-strong"
    >
      <p className="truncate text-sm font-semibold">{printer.name}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <StateBadge state={status.state} />
        {status.job && (
          <span className="text-xs font-semibold tabular-nums">
            {formatPercent(status.job.progress)}
          </span>
        )}
      </div>
      {status.job && (
        <div className="mt-2">
          <ProgressBar value={status.job.progress} label={t("printer.progress")} />
        </div>
      )}
    </Link>
  );
}

function ListView({ printers, groups }: { printers: Printer[]; groups: PrinterGroup[] }) {
  const t = useT();
  return (
    <div className="card mt-4 overflow-x-auto px-4 pt-3 pb-1">
      <table className="table min-w-[720px]">
        <thead>
          <tr>
            {(["name", "state", "job", "progress", "eta", "group"] as const).map((column) => (
              <th key={column} scope="col">
                {t(`fleet.columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {printers.map((printer) => (
            <tr key={printer.id} className="hover:bg-surface-2">
              <td className="font-semibold">
                <Link
                  to="/printers/$printerId"
                  params={{ printerId: printer.id }}
                  className="hover:underline"
                >
                  {printer.name}
                </Link>
              </td>
              <td>
                <StateBadge state={printer.status.state} />
              </td>
              <td className="max-w-56 truncate text-muted">
                {printer.status.job?.fileName ?? "—"}
              </td>
              <td>
                {printer.status.job ? (
                  <div className="flex items-center gap-2">
                    <div className="w-24">
                      <ProgressBar
                        value={printer.status.job.progress}
                        label={t("printer.progress")}
                      />
                    </div>
                    <span className="text-xs tabular-nums">
                      {formatPercent(printer.status.job.progress)}
                    </span>
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td className="text-muted tabular-nums">
                {formatDuration(t, printer.status.job?.remainingSeconds)}
              </td>
              <td className="text-muted tabular-nums">
                {groupName(groups, printer.groupId) ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
