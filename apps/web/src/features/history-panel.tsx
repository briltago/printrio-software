import type { JobHistoryDto, JobStatus, PrinterState } from "@printrio/shared";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { FormError } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { formatDuration, formatFilament, formatRelativeTime } from "../lib/format.ts";
import { Thumbnail, thumbnailUrl } from "./files-panel.tsx";
import { Panel } from "./panel.tsx";

const PAGE = 10;
/** Job status → existing state colours (green / muted / red / amber / accent). */
const STATUS_CLASS: Record<JobStatus, string> = {
  completed: "state-idle",
  cancelled: "state-offline",
  error: "state-error",
  interrupted: "state-paused",
  in_progress: "state-printing",
};

/** Moonraker print history for this printer, newest first. */
export function HistoryPanel({
  printerId,
  state,
  canPrint,
  connected,
}: {
  printerId: string;
  state: PrinterState;
  canPrint: boolean;
  connected: boolean;
}) {
  const t = useT();
  const history = useInfiniteQuery({
    queryKey: ["history", printerId],
    queryFn: ({ pageParam }) =>
      api<JobHistoryDto>(`/api/printers/${printerId}/history?limit=${PAGE}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.jobs.length < PAGE ? undefined : pages.length * PAGE),
    enabled: connected,
    retry: false,
  });
  const reprint = useMutation({
    mutationFn: (path: string) =>
      api(`/api/printers/${printerId}/commands`, {
        method: "POST",
        body: { action: "start_print", path },
      }),
  });
  // A job starting or finishing changes the history; refresh when the printer state changes.
  const { refetch } = history;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `state` is the trigger, not an input.
  useEffect(() => {
    if (connected) void refetch();
  }, [state, connected, refetch]);

  const jobs = history.data?.pages.flatMap((page) => page.jobs) ?? [];
  const totals = history.data?.pages[0]?.totals;

  return (
    <Panel id="history" title={t("history.title")}>
      <FormError error={(history.error as Error | null) ?? reprint.error} />
      {totals && totals.jobs > 0 && (
        <dl className="mb-4 grid grid-cols-3 gap-2">
          {[
            [t("history.jobs"), String(totals.jobs)],
            [t("history.totalTime"), formatDuration(t, totals.printSeconds)],
            [t("history.totalFilament"), formatFilament(totals.filamentMm)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-[7px] border border-line bg-sidebar px-3 py-2">
              <dt className="text-xs text-subtle">{label}</dt>
              <dd className="font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {history.data && jobs.length === 0 && (
        <p className="py-6 text-center text-sm text-muted">{t("history.empty")}</p>
      )}
      {/* Long histories scroll inside the panel instead of stretching the page. */}
      <ul className="-mr-2 max-h-[26rem] divide-y divide-line overflow-y-auto pr-2">
        {jobs.map((job) => (
          <li key={job.id} className="flex items-center gap-2.5 py-2">
            <Thumbnail
              src={job.hasThumbnail ? thumbnailUrl(printerId, job.fileName) : null}
              size={32}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={job.fileName}>
                {job.fileName.slice(job.fileName.lastIndexOf("/") + 1)}
              </p>
              <p className="truncate text-xs text-subtle">
                {formatRelativeTime(job.startedAt)} · {formatDuration(t, job.printSeconds)} ·{" "}
                {formatFilament(job.filamentMm)}
              </p>
            </div>
            <span className={`badge shrink-0 ${STATUS_CLASS[job.status]}`}>
              {t(`history.statuses.${job.status}`)}
            </span>
            {job.status !== "in_progress" && (
              <button
                type="button"
                className="btn btn-secondary btn-sm shrink-0 px-2"
                title={t("history.reprint")}
                aria-label={t("history.reprintFile", {
                  name: job.fileName.slice(job.fileName.lastIndexOf("/") + 1),
                })}
                disabled={!canPrint || reprint.isPending}
                onClick={() => reprint.mutate(job.fileName)}
              >
                <span aria-hidden="true">↻</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {history.hasNextPage && (
        <button
          type="button"
          className="btn btn-secondary btn-sm mt-3 w-full"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {t("history.loadMore")}
        </button>
      )}
    </Panel>
  );
}
