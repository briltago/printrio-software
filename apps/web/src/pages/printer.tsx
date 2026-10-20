import type { PrinterCommand, RestartRequest } from "@printrio/shared";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import {
  Dialog,
  EmptyState,
  FormError,
  PageHeader,
  ProgressBar,
  StateBadge,
} from "../components.tsx";
import { ConsolePanel } from "../features/console-panel.tsx";
import { FilesPanel } from "../features/files-panel.tsx";
import { HistoryPanel } from "../features/history-panel.tsx";
import { MacrosPanel } from "../features/macros-panel.tsx";
import { ObjectExclusion } from "../features/object-exclusion.tsx";
import { Panel } from "../features/panel.tsx";
import { PowerPanel } from "../features/power-panel.tsx";
import { PrinterForm } from "../features/printer-form.tsx";
import { QueuePanel } from "../features/queue-panel.tsx";
import { SpoolPanel } from "../features/spool-panel.tsx";
import { TemperaturePanel } from "../features/temperature-panel.tsx";
import { ToolheadPanel } from "../features/toolhead-panel.tsx";
import { TuningPanel } from "../features/tuning-panel.tsx";
import { WebcamPanel } from "../features/webcam-panel.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { formatDuration, formatFilament, formatPercent } from "../lib/format.ts";
import { groupsQuery, printersQuery } from "../lib/queries.ts";
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
  const restart = useMutation({
    mutationFn: (body: RestartRequest) =>
      api(`/api/printers/${printerId}/restart`, { method: "POST", body }),
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
  const canPrint = status.state === "idle" && printer.withinLimit;
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
          <>
            <Link
              to="/printers/$printerId/maintenance"
              params={{ printerId: printer.id }}
              className="btn btn-secondary"
            >
              {t("maintenance.open")}
            </Link>
            {isAdmin && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditing(true)}
                >
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
            )}
          </>
        }
      />
      {!printer.withinLimit && (
        <p className="mt-3 text-sm text-warning">{t("printer.outsideLimit")}</p>
      )}
      <FormError error={command.error ?? restart.error ?? remove.error} />

      {/* Two columns on wide screens; one column below, ordered by importance (webcam, job, temperatures, …). */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <div className="contents lg:grid lg:min-w-0 lg:grid-cols-1 lg:content-start lg:gap-4">
          <div className="order-1 min-w-0 empty:hidden lg:order-none">
            <WebcamPanel printerId={printer.id} connected={connected} />
          </div>
          <div className="order-2 min-w-0 empty:hidden lg:order-none">
            <Panel id="job" title={t("printer.job")}>
              {job ? (
                <div>
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
                    <Stat
                      label={t("printer.elapsed")}
                      value={formatDuration(t, job.elapsedSeconds)}
                    />
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
                <p className="text-sm text-muted">{t("printer.noJob")}</p>
              )}
              {status.exclusion && (
                <ObjectExclusion printerId={printer.id} exclusion={status.exclusion} />
              )}
              <div className="mt-6 flex flex-wrap gap-2 border-line border-t pt-4">
                {status.state === "error" && connected && (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={restart.isPending}
                      onClick={() => restart.mutate({ target: "firmware" })}
                    >
                      {t("system.restartFirmware")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={restart.isPending}
                      onClick={() => restart.mutate({ target: "klipper" })}
                    >
                      {t("system.restartKlipper")}
                    </button>
                  </>
                )}
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
            </Panel>
          </div>
          <div className="order-3 min-w-0 empty:hidden lg:order-none">
            <QueuePanel printerId={printer.id} canPrint={canPrint} />
          </div>
          <div className="order-6 min-w-0 empty:hidden lg:order-none">
            {status.motion && (
              <ToolheadPanel printerId={printer.id} motion={status.motion} state={status.state} />
            )}
          </div>
          <div className="order-10 min-w-0 empty:hidden lg:order-none">
            <FilesPanel
              printerId={printer.id}
              printerName={printer.name}
              canPrint={canPrint}
              connected={connected}
            />
          </div>
          <div className="order-12 min-w-0 empty:hidden lg:order-none">
            <ConsolePanel
              printerId={printer.id}
              connected={connected}
              disabled={!connected || !printer.withinLimit}
            />
          </div>
        </div>
        <div className="contents lg:grid lg:min-w-0 lg:grid-cols-1 lg:content-start lg:gap-4">
          <div className="order-5 min-w-0 empty:hidden lg:order-none">
            <TemperaturePanel
              printerId={printer.id}
              temperatures={status.temperatures}
              connected={connected}
            />
          </div>
          <div className="order-7 min-w-0 empty:hidden lg:order-none">
            {status.motion && (
              <TuningPanel
                printerId={printer.id}
                motion={status.motion}
                fans={status.fans}
                connected={connected}
              />
            )}
          </div>
          <div className="order-4 min-w-0 empty:hidden lg:order-none">
            <SpoolPanel printerId={printer.id} activeSpoolId={printer.activeSpoolId} />
          </div>
          <div className="order-8 min-w-0 empty:hidden lg:order-none">
            <PowerPanel
              printerId={printer.id}
              connected={connected}
              busy={status.state === "printing" || status.state === "paused"}
            />
          </div>
          <div className="order-9 min-w-0 empty:hidden lg:order-none">
            <MacrosPanel
              printerId={printer.id}
              connected={connected}
              disabled={!connected || !printer.withinLimit}
            />
          </div>
          <div className="order-11 min-w-0 empty:hidden lg:order-none">
            <HistoryPanel
              printerId={printer.id}
              state={status.state}
              canPrint={canPrint}
              connected={connected}
            />
          </div>
        </div>
      </div>

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
