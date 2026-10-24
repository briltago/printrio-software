import type { OrderDto, QueueItemDto } from "@printrio/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Field, FormError } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { Panel } from "./panel.tsx";

export const queueKey = (printerId: string) => ["queue", printerId];

export function useQueue(printerId: string) {
  return useQuery({
    queryKey: queueKey(printerId),
    queryFn: () => api<{ items: QueueItemDto[] }>(`/api/printers/${printerId}/queue`),
  });
}

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Prints waiting on this printer; the next one is started by hand once the bed is clear. */
export function QueuePanel({ printerId, canPrint }: { printerId: string; canPrint: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const queue = useQueue(printerId);
  const setItems = (data: { items: QueueItemDto[] }) =>
    queryClient.setQueryData(queueKey(printerId), { items: data.items });
  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      api<{ items: QueueItemDto[] }>(`/api/printers/${printerId}/queue/order`, {
        method: "PUT",
        body: { ids },
      }),
    onSuccess: setItems,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/printers/${printerId}/queue/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queueKey(printerId) }),
  });
  const start = useMutation({
    mutationFn: () =>
      api<{ items: QueueItemDto[] }>(`/api/printers/${printerId}/queue/start`, { method: "POST" }),
    onSuccess: setItems,
  });

  const items = queue.data?.items ?? [];
  if (items.length === 0) return null;
  const move = (from: number, to: number) => {
    const ids = items.map((item) => item.id);
    const [id] = ids.splice(from, 1);
    if (id) ids.splice(to, 0, id);
    reorder.mutate(ids);
  };
  const next = items[0];

  return (
    <Panel
      id="queue"
      title={t("queue.title", { count: items.length })}
      actions={
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!canPrint || start.isPending}
          title={canPrint ? undefined : t("queue.notReady")}
          onClick={() =>
            next &&
            window.confirm(t("queue.startConfirm", { name: fileName(next.path) })) &&
            start.mutate()
          }
        >
          {t("queue.startNext")}
        </button>
      }
    >
      <FormError error={start.error ?? reorder.error ?? remove.error} />
      <ol className="grid grid-cols-1 gap-1.5">
        {items.map((item, index) => (
          <li
            key={item.id}
            className="flex items-center gap-2 rounded-[7px] border border-line px-3 py-2 text-sm"
          >
            <span className="w-5 shrink-0 text-xs text-subtle tabular-nums">{index + 1}.</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium" title={item.path}>
                {fileName(item.path)}
              </span>
              {(item.orderName || item.addedBy) && (
                <span className="block truncate text-xs text-subtle">
                  {[item.orderName && t("queue.forOrder", { name: item.orderName }), item.addedBy]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm px-2"
              aria-label={t("queue.moveUp", { name: fileName(item.path) })}
              disabled={index === 0 || reorder.isPending}
              onClick={() => move(index, index - 1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm px-2"
              aria-label={t("queue.moveDown", { name: fileName(item.path) })}
              disabled={index === items.length - 1 || reorder.isPending}
              onClick={() => move(index, index + 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm px-2"
              aria-label={t("queue.remove", { name: fileName(item.path) })}
              disabled={remove.isPending}
              onClick={() => remove.mutate(item.id)}
            >
              ✕
            </button>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/** "Add to queue" for one file: copies and an optional order. */
export function QueueForm({
  printerId,
  path,
  onDone,
}: {
  printerId: string;
  path: string;
  onDone: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [copies, setCopies] = useState("1");
  const [orderId, setOrderId] = useState("");
  const orders = useQuery({
    queryKey: ["orders"],
    queryFn: () => api<{ orders: OrderDto[] }>("/api/orders"),
  });
  const add = useMutation({
    mutationFn: () =>
      api(`/api/printers/${printerId}/queue`, {
        method: "POST",
        body: { path, copies: Number(copies) || 1, orderId: orderId || null },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queueKey(printerId) });
      onDone();
    },
  });
  const open = (orders.data?.orders ?? []).filter(
    (order) => order.status === "new" || order.status === "in_progress",
  );
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate();
  };
  return (
    <form onSubmit={onSubmit}>
      <p className="mb-4 text-sm text-muted">{t("queue.addHint", { name: fileName(path) })}</p>
      <FormError error={add.error} />
      <div className="grid gap-x-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <Field
          label={t("queue.copies")}
          name="copies"
          type="number"
          min={1}
          max={50}
          value={copies}
          onChange={(event) => setCopies(event.target.value)}
        />
        <label className="mb-4 block text-sm">
          <span className="mb-1.5 block text-muted">{t("queue.order")}</span>
          <select
            className="input"
            value={orderId}
            onChange={(event) => setOrderId(event.target.value)}
          >
            <option value="">{t("jobs.noOrder")}</option>
            {open.map((order) => (
              <option key={order.id} value={order.id}>
                {order.name}
                {order.customer ? ` · ${order.customer}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={onDone}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="btn btn-primary" disabled={add.isPending}>
          {t("queue.add")}
        </button>
      </div>
    </form>
  );
}
