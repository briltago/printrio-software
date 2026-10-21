import type { Printer, PrinterGroup, PrinterState } from "@printrio/shared";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Dialog, EmptyState, PageHeader, ProgressBar, StateBadge } from "../components.tsx";
import { PrinterForm } from "../features/printer-form.tsx";
import { useT } from "../i18n/index.tsx";
import { formatDuration, formatPercent, formatTemp, heaterName } from "../lib/format.ts";
import { groupsQuery, printersQuery } from "../lib/queries.ts";
import { meQuery } from "../lib/session.ts";
import { useStoredState } from "../lib/stored-state.ts";

type ViewMode = "cards" | "compact" | "list";
const STATES: PrinterState[] = ["printing", "paused", "idle", "error", "offline", "connecting"];

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
  const filtered = printers.filter(
    (p) =>
      (!search || p.name.toLowerCase().includes(search.toLowerCase())) &&
      (!state || p.status.state === state) &&
      (!groupId || p.groupId === groupId) &&
      (!tag || p.tags.includes(tag)),
  );
  const printing = printers.filter((p) => p.status.state === "printing").length;
  const addButton = isAdmin && (
    <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
      {t("printer.add")}
    </button>
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:p-6 md:p-8">
      <PageHeader
        kicker={t("nav.printers")}
        title={t("fleet.title")}
        subtitle={
          <>
            {t("fleet.subtitle", { count: printers.length, printing })}
            {data.limit !== null && (
              <span className="ml-2 text-subtle">
                · {t("fleet.limit", { used: printers.length, limit: data.limit })}
              </span>
            )}
          </>
        }
        actions={addButton}
      />

      {printers.length === 0 ? (
        <EmptyState title={t("fleet.empty")} text={t("fleet.emptyText")} action={addButton} />
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <input
              type="search"
              className="input max-w-56"
              placeholder={t("fleet.searchPlaceholder")}
              aria-label={t("fleet.searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Filter
              label={t("fleet.filterState")}
              value={state}
              onChange={setState}
              options={STATES.map((s) => [s, t(`printer.states.${s}`)])}
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
            <fieldset className="ml-auto flex rounded-[11px] border border-line p-0.5">
              <legend className="sr-only">View</legend>
              {(["cards", "compact", "list"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={view === mode}
                  onClick={() => setView(mode)}
                  className={`tap rounded-[9px] px-3 py-1.5 text-xs font-semibold ${view === mode ? "bg-accent/15 text-text" : "text-muted hover:text-text"}`}
                >
                  {t(`fleet.view${mode[0]?.toUpperCase()}${mode.slice(1)}` as "fleet.viewCards")}
                </button>
              ))}
            </fieldset>
          </div>

          {filtered.length === 0 ? (
            <p className="mt-10 text-center text-sm text-muted">{t("fleet.noMatches")}</p>
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
      className="input w-auto py-2 text-sm"
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
      className="card block p-5 transition-colors hover:border-line-strong"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{printer.name}</p>
          {meta.length > 0 && (
            <p className="mt-0.5 truncate text-xs text-subtle">{meta.join(" · ")}</p>
          )}
        </div>
        <StateBadge state={status.state} />
      </div>
      <div className="mt-5 min-h-[52px]">
        {status.job ? (
          <>
            <div className="mb-2 flex justify-between gap-3 text-sm">
              <span className="truncate text-muted">{status.job.fileName}</span>
              <span className="font-semibold">{formatPercent(status.job.progress)}</span>
            </div>
            <ProgressBar value={status.job.progress} label={t("printer.progress")} />
            <p className="mt-2 text-xs text-subtle">
              {t("printer.remaining")}: {formatDuration(t, status.job.remainingSeconds)}
            </p>
          </>
        ) : (
          <p className="text-sm text-subtle">{status.message ?? t("printer.noJob")}</p>
        )}
      </div>
      {status.temperatures.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-line border-t pt-3 text-xs text-muted">
          {status.temperatures.slice(0, 3).map((temp) => (
            <span key={temp.name}>
              {heaterName(t, temp.name)}{" "}
              <span className="font-semibold text-text">{formatTemp(temp.current)}</span>
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
          <span className="text-xs font-semibold">{formatPercent(status.job.progress)}</span>
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
    <div className="card mt-4 overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-line border-b text-xs text-subtle">
          <tr>
            {(["name", "state", "job", "progress", "eta", "group"] as const).map((column) => (
              <th key={column} scope="col" className="px-4 py-3 font-semibold">
                {t(`fleet.columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {printers.map((printer) => (
            <tr key={printer.id} className="border-line border-b last:border-0 hover:bg-surface-2">
              <td className="px-4 py-3 font-semibold">
                <Link
                  to="/printers/$printerId"
                  params={{ printerId: printer.id }}
                  className="hover:text-accent-2"
                >
                  {printer.name}
                </Link>
              </td>
              <td className="px-4 py-3">
                <StateBadge state={printer.status.state} />
              </td>
              <td className="max-w-56 truncate px-4 py-3 text-muted">
                {printer.status.job?.fileName ?? "—"}
              </td>
              <td className="px-4 py-3">
                {printer.status.job ? (
                  <div className="flex items-center gap-2">
                    <div className="w-24">
                      <ProgressBar
                        value={printer.status.job.progress}
                        label={t("printer.progress")}
                      />
                    </div>
                    <span className="text-xs">{formatPercent(printer.status.job.progress)}</span>
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3 text-muted">
                {formatDuration(t, printer.status.job?.remainingSeconds)}
              </td>
              <td className="px-4 py-3 text-muted">{groupName(groups, printer.groupId) ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
