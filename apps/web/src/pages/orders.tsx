import {
  type JobListDto,
  ORDER_STATUSES,
  type OrderDetailDto,
  type OrderDto,
  type OrderStatus,
  renderFolderTemplate,
} from "@printrio/shared";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { type FormEvent, useRef, useState } from "react";
import { Dialog, EmptyState, Field, FormError, PageHeader } from "../components.tsx";
import { Swatch } from "../features/filament-forms.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import {
  formatBytes,
  formatDuration,
  formatMoney,
  formatRelativeTime,
  formatWeight,
} from "../lib/format.ts";
import { JOB_STATUS_CLASS } from "../lib/jobs.ts";
import { settingsQuery } from "../lib/queries.ts";
import { meQuery } from "../lib/session.ts";
import { useStoredState } from "../lib/stored-state.ts";
import { uploadFile } from "../lib/upload.ts";

export const ORDER_STATUS_CLASS: Record<OrderStatus, string> = {
  new: "state-paused",
  in_progress: "state-printing",
  done: "state-idle",
  cancelled: "state-offline",
};
type Filter = "active" | "done" | "cancelled" | "all";
const FILTERS: Filter[] = ["active", "done", "cancelled", "all"];
const matches = (filter: Filter, status: OrderStatus) =>
  filter === "all" ||
  (filter === "active" ? status === "new" || status === "in_progress" : status === filter);

export const ordersQueryKey = ["orders"];

function useInvalidateOrders() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ordersQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["jobs"] }),
    ]);
}

/** Simple orders: who a set of prints is for and how far it is. */
export function OrdersPage() {
  const t = useT();
  const [filter, setFilter] = useStoredState<Filter>("printrio-orders-filter", "active");
  const { order: linked } = useSearch({ from: "/app/orders" });
  const [editing, setEditing] = useState<"new" | string | null>(linked ?? null);
  const invalidate = useInvalidateOrders();
  const orders = useQuery({
    queryKey: ordersQueryKey,
    queryFn: () => api<{ orders: OrderDto[] }>("/api/orders"),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) =>
      api(`/api/orders/${id}`, { method: "PATCH", body: { status } }),
    onSuccess: invalidate,
  });
  const list = (orders.data?.orders ?? []).filter((order) => matches(filter, order.status));

  return (
    <main className="mx-auto max-w-6xl p-6 md:p-8">
      <PageHeader
        title={t("nav.orders")}
        subtitle={t("orders.subtitle")}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
            {t("orders.new")}
          </button>
        }
      />
      <nav className="mt-6 flex gap-1 border-line border-b" aria-label={t("orders.filter")}>
        {FILTERS.map((id) => (
          <button
            key={id}
            type="button"
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              filter === id
                ? "border-accent font-semibold text-text"
                : "border-transparent text-muted hover:text-text"
            }`}
            aria-current={filter === id ? "page" : undefined}
            onClick={() => setFilter(id)}
          >
            {t(`orders.filters.${id}`)}
          </button>
        ))}
      </nav>
      <div className="mt-6">
        <FormError error={orders.error ?? setStatus.error} />
        {orders.data && list.length === 0 ? (
          <EmptyState
            title={t("orders.emptyTitle")}
            text={t("orders.emptyText")}
            action={
              <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
                {t("orders.new")}
              </button>
            }
          />
        ) : (
          <div className="card overflow-x-auto p-4">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-subtle">
                <tr>
                  <th scope="col" className="pb-2 font-semibold">
                    {t("orders.name")}
                  </th>
                  <th scope="col" className="pb-2 pr-4 font-semibold">
                    {t("orders.status")}
                  </th>
                  <th
                    scope="col"
                    className="hidden pb-2 pr-4 text-right font-semibold sm:table-cell"
                  >
                    {t("orders.prints")}
                  </th>
                  <th
                    scope="col"
                    className="hidden pb-2 pr-4 text-right font-semibold md:table-cell"
                  >
                    {t("orders.cost")}
                  </th>
                  <th scope="col" className="hidden pb-2 font-semibold lg:table-cell">
                    {t("orders.created")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((order) => (
                  <tr key={order.id} className="border-line border-t">
                    <td className="w-full max-w-0 py-2.5 pr-3">
                      <button
                        type="button"
                        className="block max-w-full truncate text-left font-medium hover:underline"
                        onClick={() => setEditing(order.id)}
                      >
                        {order.name}
                      </button>
                      {order.customer && (
                        <p className="truncate text-xs text-subtle">{order.customer}</p>
                      )}
                    </td>
                    <td className="py-2.5 pr-4">
                      <select
                        className={`badge cursor-pointer appearance-none pr-2 ${ORDER_STATUS_CLASS[order.status]}`}
                        aria-label={t("orders.statusOf", { name: order.name })}
                        value={order.status}
                        onChange={(event) =>
                          setStatus.mutate({
                            id: order.id,
                            status: event.target.value as OrderStatus,
                          })
                        }
                      >
                        {ORDER_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {t(`orders.statuses.${status}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="hidden py-2.5 pr-4 text-right tabular-nums sm:table-cell">
                      {order.jobCount}
                    </td>
                    <td className="hidden py-2.5 pr-4 text-right whitespace-nowrap tabular-nums md:table-cell">
                      {order.jobCount ? formatMoney(order.totalCost, order.currency) : "—"}
                    </td>
                    <td className="hidden py-2.5 whitespace-nowrap text-muted lg:table-cell">
                      {formatRelativeTime(order.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? t("orders.new") : t("orders.edit")}
      >
        {editing === "new" && <OrderForm onDone={() => setEditing(null)} />}
        {editing && editing !== "new" && (
          <OrderDetail orderId={editing} onDone={() => setEditing(null)} />
        )}
      </Dialog>
    </main>
  );
}

function OrderForm({ order, onDone }: { order?: OrderDto; onDone: () => void }) {
  const t = useT();
  const invalidate = useInvalidateOrders();
  const [saved, setSaved] = useState(false);
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const customers = useQuery({
    queryKey: [...ordersQueryKey, "customers"],
    queryFn: () => api<{ customers: string[] }>("/api/orders/customers"),
  });
  // Live preview of where a new order's files will go (the server renders the same template).
  const [name, setName] = useState(order?.name ?? "");
  const [customer, setCustomer] = useState(order?.customer ?? "");
  const folderPreview = renderFolderTemplate(settings.orderFolders.template, {
    order: name.trim() || t("orders.name"),
    customer: customer.trim() || null,
    date: new Date(),
  });
  const save = useMutation({
    mutationFn: (form: FormData) => {
      const folder = String(form.get("folder") ?? "").trim();
      const body = {
        name: String(form.get("name") ?? ""),
        customer: String(form.get("customer") ?? ""),
        notes: String(form.get("notes") ?? ""),
        ...(!order && folder ? { folder } : {}),
      };
      return order
        ? api(`/api/orders/${order.id}`, { method: "PATCH", body })
        : api("/api/orders", { method: "POST", body });
    },
    onSuccess: async () => {
      await invalidate();
      if (order) setSaved(true);
      else onDone();
    },
  });
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save.mutate(new FormData(event.currentTarget));
  };
  return (
    <form onSubmit={onSubmit} onChange={() => setSaved(false)}>
      <FormError error={save.error} />
      <Field
        label={t("orders.name")}
        name="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        autoFocus={!order}
      />
      <Field
        label={t("orders.customer")}
        name="customer"
        required={false}
        value={customer}
        onChange={(event) => setCustomer(event.target.value)}
        list="order-customers"
        autoComplete="off"
      />
      <datalist id="order-customers" aria-label={t("orders.customerSuggestions")}>
        {(customers.data?.customers ?? []).map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      {!order && (
        <Field
          label={t("orders.folder")}
          name="folder"
          required={false}
          placeholder={
            settings.orderFolders.enabled ? `Files/${folderPreview}` : t("orders.noFolder")
          }
          hint={t("orders.folderHint")}
          className="input font-mono text-sm"
          spellCheck={false}
        />
      )}
      <label className="mb-4 block text-sm">
        <span className="mb-1.5 block text-muted">{t("orders.notes")}</span>
        <textarea name="notes" className="input min-h-20" defaultValue={order?.notes ?? ""} />
      </label>
      <div className="flex items-center justify-end gap-2">
        {saved && (
          <span role="status" className="mr-auto text-sm text-success">
            {t("settings.saved")}
          </span>
        )}
        {!order && (
          <button type="button" className="btn btn-secondary" onClick={onDone}>
            {t("common.cancel")}
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </form>
  );
}

function OrderDetail({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const invalidate = useInvalidateOrders();
  const [adding, setAdding] = useState(false);
  const detail = useQuery({
    queryKey: [...ordersQueryKey, orderId],
    queryFn: () => api<OrderDetailDto>(`/api/orders/${orderId}`),
  });
  const unlinked = useQuery({
    queryKey: ["jobs", "unlinked"],
    queryFn: () => api<JobListDto>("/api/jobs?orderId=none&limit=30"),
    enabled: adding,
  });
  const link = useMutation({
    mutationFn: ({ jobId, link: linked }: { jobId: string; link: boolean }) =>
      api(`/api/jobs/${jobId}/order`, {
        method: "PUT",
        body: { orderId: linked ? orderId : null },
      }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/orders/${orderId}`, { method: "DELETE" }),
    onSuccess: async () => {
      await invalidate();
      onDone();
    },
  });
  const order = detail.data;
  if (!order) return <FormError error={detail.error} />;

  return (
    <div>
      <OrderForm order={order} onDone={onDone} />
      <OrderFiles order={order} />
      <section className="mt-6 border-line border-t pt-4" aria-label={t("orders.prints")}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {t("orders.printsSummary", {
              count: order.jobCount,
              cost: formatMoney(order.totalCost, order.currency),
            })}
          </h3>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setAdding((value) => !value)}
          >
            {adding ? t("orders.doneAdding") : t("orders.addPrints")}
          </button>
        </div>
        <FormError error={link.error ?? remove.error} />
        {adding && (
          <ul className="mb-4 grid max-h-56 gap-1 overflow-auto rounded-[10px] border border-line p-2">
            {unlinked.data?.jobs.length === 0 && (
              <li className="p-2 text-sm text-subtle">{t("orders.noUnlinked")}</li>
            )}
            {(unlinked.data?.jobs ?? []).map((job) => (
              <li key={job.id} className="flex items-center gap-2 rounded-[8px] px-2 py-1 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {job.fileName.slice(job.fileName.lastIndexOf("/") + 1)}
                  <span className="text-xs text-subtle">
                    {" "}
                    · {job.printerName} · {formatRelativeTime(job.startedAt)}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={link.isPending}
                  onClick={() => link.mutate({ jobId: job.id, link: true })}
                >
                  {t("common.add")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {order.jobs.length === 0 ? (
          <p className="text-sm text-subtle">{t("orders.noPrints")}</p>
        ) : (
          <ul className="grid gap-1.5">
            {order.jobs.map((job) => (
              <li key={job.id} className="flex items-center gap-2 text-sm">
                {job.spool && <Swatch color={job.spool.colorHex} size={12} />}
                <span className="min-w-0 flex-1 truncate">
                  {job.fileName.slice(job.fileName.lastIndexOf("/") + 1)}
                  <span className="text-xs text-subtle">
                    {" "}
                    · {formatWeight(job.filamentGrams)} · {formatMoney(job.totalCost, job.currency)}
                  </span>
                </span>
                <span className={`badge ${JOB_STATUS_CLASS[job.status]}`}>
                  {t(`jobs.statuses.${job.status}`)}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm px-2"
                  aria-label={t("orders.unlink")}
                  title={t("orders.unlink")}
                  disabled={link.isPending}
                  onClick={() => link.mutate({ jobId: job.id, link: false })}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {me?.role === "admin" && (
        <div className="mt-6 border-line border-t pt-4">
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() =>
              window.confirm(t("orders.deleteConfirm", { name: order.name })) && remove.mutate()
            }
          >
            {t("orders.delete")}
          </button>
        </div>
      )}
    </div>
  );
}

/** The order's folder in Files: upload G-code straight into it and see what is there. */
function OrderFiles({ order }: { order: OrderDetailDto }) {
  const t = useT();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ name: string; fraction: number } | null>(null);
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        setProgress({ name: file.name, fraction: 0 });
        await uploadFile(`/api/orders/${order.id}/files`, file, (fraction) =>
          setProgress({ name: file.name, fraction }),
        );
      }
    },
    onSettled: () => {
      setProgress(null);
      void queryClient.invalidateQueries({ queryKey: [...ordersQueryKey, order.id] });
      void queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });

  return (
    <section className="mt-6 border-line border-t pt-4" aria-label={t("orders.files")}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t("orders.files")}</h3>
          <p className="truncate font-mono text-xs text-subtle" title={order.folder ?? undefined}>
            {order.folder ? `Files/${order.folder}` : t("orders.noFolder")}
          </p>
        </div>
        <div className="flex gap-2">
          {order.folder && (
            <Link to="/files" search={{ dir: order.folder }} className="btn btn-secondary btn-sm">
              {t("orders.openInFiles")}
            </Link>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={upload.isPending}
            onClick={() => inputRef.current?.click()}
          >
            {t("orders.upload")}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".gcode,.g,.gco"
            multiple
            hidden
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              if (files.length) upload.mutate(files);
            }}
          />
        </div>
      </div>
      <FormError error={upload.error} />
      {progress && (
        <p className="mb-2 text-xs text-muted" role="status">
          {t("orders.uploading", {
            name: progress.name,
            percent: Math.round(progress.fraction * 100),
          })}
        </p>
      )}
      {order.files.length === 0 ? (
        <p className="text-sm text-subtle">{t("orders.noFiles")}</p>
      ) : (
        <ul className="grid gap-1.5">
          {order.files.map((file) => (
            <li key={file.path} className="flex items-center gap-2 text-sm">
              <span aria-hidden="true" className="text-subtle">
                ▤
              </span>
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-xs text-subtle">
                {[formatDuration(t, file.estimatedSeconds), formatBytes(file.size)]
                  .filter((part) => part !== "—")
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
