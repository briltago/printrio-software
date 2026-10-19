import type { PrinterCommand } from "@printrio/shared";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  Dialog,
  EmptyState,
  FormError,
  PageHeader,
  ProgressBar,
  StateBadge,
} from "../components.tsx";
import { PrinterForm } from "../features/printer-form.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import {
  formatDuration,
  formatFilament,
  formatPercent,
  formatTemp,
  heaterName,
} from "../lib/format.ts";
import { groupsQuery, printersQuery } from "../lib/queries.ts";
import { appendConsole, useConsole } from "../lib/realtime.ts";
import { meQuery } from "../lib/session.ts";

export function PrinterPage() {
  const t = useT();
  const { printerId } = useParams({ from: "/app/printers/$printerId" });
  const { data } = useSuspenseQuery(printersQuery);
  const { data: me } = useSuspenseQuery(meQuery);
  const { data: groupData } = useQuery(groupsQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const printer = data.printers.find((p) => p.id === printerId);
  const isAdmin = me?.role === "admin";

  const command = useMutation({
    mutationFn: (body: PrinterCommand) =>
      api(`/api/printers/${printerId}/commands`, { method: "POST", body }),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/printers/${printerId}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: printersQuery.queryKey });
      await navigate({ to: "/printers" });
    },
  });

  if (!printer) {
    return (
      <main className="mx-auto max-w-6xl p-6 md:p-8">
        <EmptyState
          title="Printer not found"
          text="It may have been removed."
          action={
            <Link to="/printers" className="btn btn-secondary">
              {t("printer.allPrinters")}
            </Link>
          }
        />
      </main>
    );
  }

  const { status } = printer;
  const job = status.job;
  const connected = status.state !== "offline" && status.state !== "connecting";
  const confirmThen = (message: string, body: PrinterCommand) => {
    if (window.confirm(message)) command.mutate(body);
  };
  const group = groupData?.groups.find((g) => g.id === printer.groupId)?.name;

  return (
    <main className="mx-auto max-w-6xl p-6 md:p-8">
      {data.printers.length > 1 && (
        <Link to="/printers" className="mb-3 inline-block text-sm text-muted hover:text-text">
          ← {t("printer.allPrinters")}
        </Link>
      )}
      <PageHeader
        kicker={[group, ...printer.tags].filter(Boolean).join(" · ") || t("nav.printers")}
        title={printer.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StateBadge state={status.state} />
            {status.message && <span>{status.message}</span>}
          </span>
        }
        actions={
          isAdmin && (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
                {t("common.edit")}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() =>
                  window.confirm(t("printer.deleteConfirm", { name: printer.name })) &&
                  remove.mutate()
                }
              >
                {t("common.delete")}
              </button>
            </>
          )
        }
      />
      {!printer.withinLimit && (
        <p className="mt-3 text-sm text-warning">{t("printer.outsideLimit")}</p>
      )}
      <FormError error={command.error ?? remove.error} />

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="card p-5" aria-labelledby="job-title">
          <h2 id="job-title" className="text-sm font-semibold">
            {t("printer.job")}
          </h2>
          {job ? (
            <div className="mt-4">
              <div className="flex items-end justify-between gap-3">
                <p className="truncate text-muted">{job.fileName}</p>
                <p className="text-3xl font-semibold tracking-[-0.06em]">
                  {formatPercent(job.progress)}
                </p>
              </div>
              <div className="mt-3">
                <ProgressBar value={job.progress} label={t("printer.progress")} />
              </div>
              <dl className="mt-5 grid grid-cols-3 gap-3 text-sm">
                <Stat label={t("printer.elapsed")} value={formatDuration(t, job.elapsedSeconds)} />
                <Stat
                  label={t("printer.remaining")}
                  value={formatDuration(t, job.remainingSeconds)}
                />
                <Stat
                  label={t("printer.filamentUsed")}
                  value={formatFilament(job.filamentUsedMm)}
                />
              </dl>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">{t("printer.noJob")}</p>
          )}
          <div className="mt-6 flex flex-wrap gap-2 border-line border-t pt-4">
            {status.state === "printing" && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => command.mutate({ action: "pause" })}
              >
                {t("printer.pause")}
              </button>
            )}
            {status.state === "paused" && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => command.mutate({ action: "resume" })}
              >
                {t("printer.resume")}
              </button>
            )}
            {(status.state === "printing" || status.state === "paused") && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  confirmThen(t("printer.cancelConfirm", { name: printer.name }), {
                    action: "cancel",
                  })
                }
              >
                {t("printer.cancelPrint")}
              </button>
            )}
            <button
              type="button"
              className="btn btn-danger btn-sm ml-auto"
              disabled={!connected}
              onClick={() =>
                confirmThen(t("printer.emergencyConfirm", { name: printer.name }), {
                  action: "emergency_stop",
                })
              }
            >
              {t("printer.emergencyStop")}
            </button>
          </div>
        </section>

        <section className="card p-5" aria-labelledby="temps-title">
          <h2 id="temps-title" className="text-sm font-semibold">
            {t("printer.temperatures")}
          </h2>
          {status.temperatures.length === 0 ? (
            <p className="mt-4 text-sm text-muted">—</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {status.temperatures.map((temp) => (
                <li key={temp.name} className="flex items-baseline justify-between py-2.5">
                  <span className="text-sm text-muted">{heaterName(t, temp.name)}</span>
                  <span>
                    <span className="text-lg font-semibold">{formatTemp(temp.current)}</span>
                    {temp.target ? (
                      <span className="ml-2 text-xs text-subtle">
                        {t("printer.target", { value: formatTemp(temp.target) })}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Console printerId={printer.id} disabled={!connected || !printer.withinLimit} />

      <Dialog open={editing} onClose={() => setEditing(false)} title={t("printer.editTitle")}>
        <PrinterForm
          printer={printer}
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </Dialog>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="mt-0.5 font-semibold">{value}</dd>
    </div>
  );
}

function Console({ printerId, disabled }: { printerId: string; disabled: boolean }) {
  const t = useT();
  const lines = useConsole(printerId);
  const [script, setScript] = useState("");
  const outputRef = useRef<HTMLPreElement>(null);
  const send = useMutation({
    mutationFn: (value: string) =>
      api(`/api/printers/${printerId}/commands`, {
        method: "POST",
        body: { action: "gcode", script: value },
      }),
  });

  useEffect(() => {
    const output = outputRef.current;
    if (output && lines.length) output.scrollTop = output.scrollHeight;
  }, [lines]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const value = script.trim();
    if (!value) return;
    appendConsole(printerId, `> ${value}`);
    send.mutate(value);
    setScript("");
  };

  return (
    <section className="card mt-4 p-5" aria-labelledby="console-title">
      <h2 id="console-title" className="text-sm font-semibold">
        {t("printer.console")}
      </h2>
      <pre
        ref={outputRef}
        className="mt-3 h-48 overflow-auto rounded-[10px] border border-line bg-sidebar p-3 font-mono text-xs leading-relaxed text-muted"
        aria-live="polite"
      >
        {lines.length ? lines.join("\n") : t("printer.consoleEmpty")}
      </pre>
      <FormError error={send.error} />
      <form onSubmit={onSubmit} className="mt-3 flex gap-2">
        <input
          className="input font-mono"
          value={script}
          onChange={(event) => setScript(event.target.value)}
          placeholder={t("printer.consolePlaceholder")}
          aria-label={t("printer.consolePlaceholder")}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="btn btn-secondary" disabled={disabled || send.isPending}>
          {t("printer.send")}
        </button>
      </form>
    </section>
  );
}
