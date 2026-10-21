import type { JobListDto, OrderDto, RecordedJobStatus } from "@printrio/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { EmptyState, FormError, PageHeader } from "../components.tsx";
import { Swatch } from "../features/filament-forms.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { formatDuration, formatMoney, formatRelativeTime, formatWeight } from "../lib/format.ts";
import { JOB_STATUS_CLASS } from "../lib/jobs.ts";
import { printersQuery } from "../lib/queries.ts";

const PAGE = 50;
const STATUSES: RecordedJobStatus[] = [
  "printing",
  "completed",
  "cancelled",
  "error",
  "interrupted",
];

/** Every print recorded by Printrio across all printers, with its cost. */
export function JobsPage() {
  const t = useT();
  const { data: printerData } = useQuery(printersQuery);
  const [printerId, setPrinterId] = useState("");
  const [status, setStatus] = useState("");
  const params = new URLSearchParams();
  if (printerId) params.set("printerId", printerId);
  if (status) params.set("status", status);
  const jobs = useInfiniteQuery({
    queryKey: ["jobs", printerId, status],
    queryFn: ({ pageParam }) =>
      api<JobListDto>(`/api/jobs?${params}&limit=${PAGE}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      pages.length * PAGE < last.total ? pages.length * PAGE : undefined,
  });
  const queryClient = useQueryClient();
  const orders = useQuery({
    queryKey: ["orders"],
    queryFn: () => api<{ orders: OrderDto[] }>("/api/orders"),
  });
  const openOrders = (orders.data?.orders ?? []).filter((o) => o.status !== "cancelled");
  const linkOrder = useMutation({
    mutationFn: ({ jobId, orderId }: { jobId: string; orderId: string | null }) =>
      api(`/api/jobs/${jobId}/order`, { method: "PUT", body: { orderId } }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
      ]),
  });
  const list = jobs.data?.pages.flatMap((page) => page.jobs) ?? [];
  const total = jobs.data?.pages[0]?.total ?? 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-5 sm:p-6 md:p-8">
      <PageHeader title={t("nav.jobs")} subtitle={jobs.data && t("jobs.count", { count: total })} />
      <div className="mt-6 mb-4 flex flex-wrap gap-2">
        <select
          className="input w-auto py-1.5 text-sm"
          aria-label={t("jobs.printer")}
          value={printerId}
          onChange={(event) => setPrinterId(event.target.value)}
        >
          <option value="">{t("jobs.allPrinters")}</option>
          {(printerData?.printers ?? []).map((printer) => (
            <option key={printer.id} value={printer.id}>
              {printer.name}
            </option>
          ))}
        </select>
        <select
          className="input w-auto py-1.5 text-sm"
          aria-label={t("jobs.status")}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">{t("jobs.allStatuses")}</option>
          {STATUSES.map((id) => (
            <option key={id} value={id}>
              {t(`jobs.statuses.${id}`)}
            </option>
          ))}
        </select>
      </div>
      <FormError error={jobs.error ?? linkOrder.error} />
      {jobs.data && list.length === 0 ? (
        <EmptyState title={t("jobs.emptyTitle")} text={t("jobs.emptyText")} />
      ) : (
        <div className="card overflow-x-auto p-4">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-subtle">
              <tr>
                <th scope="col" className="pb-2 font-semibold">
                  {t("jobs.file")}
                </th>
                <th scope="col" className="hidden pb-2 pr-4 font-semibold md:table-cell">
                  {t("jobs.printer")}
                </th>
                <th scope="col" className="pb-2 pr-4 font-semibold">
                  {t("jobs.status")}
                </th>
                <th scope="col" className="hidden pb-2 pr-4 font-semibold sm:table-cell">
                  {t("jobs.duration")}
                </th>
                <th scope="col" className="hidden pb-2 pr-4 font-semibold lg:table-cell">
                  {t("jobs.filament")}
                </th>
                {openOrders.length > 0 && (
                  <th scope="col" className="hidden pb-2 pr-4 font-semibold xl:table-cell">
                    {t("jobs.order")}
                  </th>
                )}
                <th scope="col" className="pb-2 text-right font-semibold">
                  {t("jobs.cost")}
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((job) => (
                <tr key={job.id} className="border-line border-t align-top">
                  <td className="w-full max-w-0 py-2.5 pr-3">
                    <p className="truncate font-medium" title={job.fileName}>
                      {job.fileName.slice(job.fileName.lastIndexOf("/") + 1)}
                    </p>
                    <p className="truncate text-xs text-subtle">
                      <time
                        dateTime={job.startedAt}
                        title={new Date(job.startedAt).toLocaleString()}
                      >
                        {formatRelativeTime(job.startedAt)}
                      </time>
                      <span className="md:hidden"> · {job.printerName}</span>
                    </p>
                  </td>
                  <td className="hidden py-2.5 pr-4 whitespace-nowrap md:table-cell">
                    {job.printerId ? (
                      <Link
                        to="/printers/$printerId"
                        params={{ printerId: job.printerId }}
                        className="hover:underline"
                      >
                        {job.printerName}
                      </Link>
                    ) : (
                      <span className="text-muted">{job.printerName}</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className={`badge ${JOB_STATUS_CLASS[job.status]}`}>
                      {t(`jobs.statuses.${job.status}`)}
                    </span>
                  </td>
                  <td className="hidden py-2.5 pr-4 whitespace-nowrap tabular-nums sm:table-cell">
                    {formatDuration(t, job.printSeconds)}
                  </td>
                  <td className="hidden py-2.5 pr-4 lg:table-cell">
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      {job.spool && <Swatch color={job.spool.colorHex} size={12} />}
                      <span className="tabular-nums">{formatWeight(job.filamentGrams)}</span>
                      {job.spool && (
                        <span
                          className="max-w-40 truncate text-xs text-subtle"
                          title={job.spool.label}
                        >
                          {job.spool.label}
                        </span>
                      )}
                    </span>
                  </td>
                  {openOrders.length > 0 && (
                    <td className="hidden py-2 pr-4 xl:table-cell">
                      <select
                        className="input w-40 py-1 text-xs"
                        aria-label={t("jobs.orderOf", { name: job.fileName })}
                        value={job.orderId ?? ""}
                        disabled={linkOrder.isPending}
                        onChange={(event) =>
                          linkOrder.mutate({ jobId: job.id, orderId: event.target.value || null })
                        }
                      >
                        <option value="">{t("jobs.noOrder")}</option>
                        {(orders.data?.orders ?? [])
                          .filter((o) => o.status !== "cancelled" || o.id === job.orderId)
                          .map((order) => (
                            <option key={order.id} value={order.id}>
                              {order.name}
                            </option>
                          ))}
                      </select>
                    </td>
                  )}
                  <td
                    className="py-2.5 text-right whitespace-nowrap tabular-nums"
                    title={
                      job.totalCost !== null
                        ? t("jobs.costBreakdown", {
                            material: formatMoney(job.materialCost, job.currency),
                            energy: formatMoney(job.energyCost, job.currency),
                          })
                        : undefined
                    }
                  >
                    {formatMoney(job.totalCost, job.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {jobs.hasNextPage && (
            <button
              type="button"
              className="btn btn-secondary btn-sm mt-3 w-full"
              disabled={jobs.isFetchingNextPage}
              onClick={() => void jobs.fetchNextPage()}
            >
              {t("history.loadMore")}
            </button>
          )}
        </div>
      )}
    </main>
  );
}
