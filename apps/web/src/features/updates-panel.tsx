import type { SoftwareComponentDto, UpdateActionDto, UpdateStatusDto } from "@printrio/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { FormError } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { formatRelativeTime } from "../lib/format.ts";
import { clearUpdateLog, useUpdateLog } from "../lib/realtime.ts";

/** Software updates of the printer host via Moonraker's update manager. */
export function UpdatesPanel({ printerId, busy }: { printerId: string; busy: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const queryKey = ["updates", printerId];
  const log = useUpdateLog(printerId);
  const logRef = useRef<HTMLPreElement>(null);
  const status = useQuery({
    queryKey,
    queryFn: () => api<UpdateStatusDto>(`/api/printers/${printerId}/updates`),
    // Updating Moonraker restarts it; retry while it comes back.
    retry: 5,
    retryDelay: 2000,
  });
  const action = useMutation({
    mutationFn: (body: UpdateActionDto) =>
      api(`/api/printers/${printerId}/updates`, { method: "POST", body }),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  useEffect(() => {
    const output = logRef.current;
    if (output && log.length) output.scrollTop = output.scrollHeight;
  }, [log]);

  const components = status.data?.components ?? [];
  const updatable = components.filter((c) => c.updateAvailable && !c.needsRecovery);
  const running = action.isPending || status.data?.busy === true;
  const pendingName =
    action.isPending && action.variables?.op !== "refresh" ? (action.variables?.name ?? "*") : null;
  const upgrade = (name?: string) => {
    const message = name
      ? t("updates.confirmOne", { name })
      : t("updates.confirmAll", { count: updatable.length });
    if (window.confirm(message)) action.mutate({ op: "upgrade", name });
  };

  return (
    <div className="grid gap-4">
      <section className="card p-5" aria-label={t("updates.title")}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">{t("updates.title")}</h2>
            <p className="text-xs text-subtle">
              {status.isPending
                ? t("config.loading")
                : updatable.length
                  ? t("updates.available", { count: updatable.length })
                  : t("updates.upToDate")}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={running}
            onClick={() => action.mutate({ op: "refresh" })}
          >
            {action.isPending && action.variables?.op === "refresh"
              ? t("updates.checking")
              : t("updates.check")}
          </button>
          {updatable.length > 1 && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={running || busy}
              onClick={() => upgrade()}
            >
              {pendingName === "*" ? t("updates.updating") : t("updates.updateAll")}
            </button>
          )}
        </div>
        {busy && <p className="mt-3 text-sm text-warning">{t("updates.busy")}</p>}
        <div className="mt-3">
          <FormError error={action.error ?? (status.data ? null : status.error)} />
        </div>
        {status.data && components.length === 0 && (
          <p className="text-sm text-muted">{t("updates.none")}</p>
        )}
        <ul className="grid gap-2">
          {components.map((component) => (
            <ComponentRow
              key={component.name}
              component={component}
              disabled={running || busy}
              updating={pendingName === component.name || pendingName === "*"}
              onUpgrade={() => upgrade(component.name)}
              onRecover={() =>
                window.confirm(t("updates.recoverConfirm", { name: component.name })) &&
                action.mutate({ op: "recover", name: component.name })
              }
            />
          ))}
        </ul>
      </section>

      {log.length > 0 && (
        <section className="card p-5" aria-label={t("updates.log")}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{t("updates.log")}</h2>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => clearUpdateLog(printerId)}
            >
              {t("console.clear")}
            </button>
          </div>
          <pre
            ref={logRef}
            className="max-h-80 overflow-auto rounded-[7px] border border-line bg-sidebar p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-muted"
          >
            {log.map((line, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only.
              <span key={index} className={line.complete ? "text-success" : undefined}>
                <span className="text-subtle">{line.application}: </span>
                {line.message}
                {"\n"}
              </span>
            ))}
          </pre>
        </section>
      )}
    </div>
  );
}

const KIND_LABEL = {
  system: "updates.kinds.system",
  git: "updates.kinds.git",
  web: "updates.kinds.web",
  other: "updates.kinds.other",
} as const;

function ComponentRow({
  component,
  disabled,
  updating,
  onUpgrade,
  onRecover,
}: {
  component: SoftwareComponentDto;
  disabled: boolean;
  updating: boolean;
  onUpgrade: () => void;
  onRecover: () => void;
}) {
  const t = useT();
  const details =
    component.kind === "system" ? component.packages.length : component.commitsBehind.length;
  return (
    <li className="rounded-[7px] border border-line px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{component.name}</span>
            <span className="text-xs text-subtle">{t(KIND_LABEL[component.kind])}</span>
            {component.needsRecovery && (
              <span className="badge state-error">{t("updates.needsRecovery")}</span>
            )}
            {component.updateAvailable && !component.needsRecovery && (
              <span className="badge state-printing">{t("updates.updateAvailable")}</span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted tabular-nums">
            {component.kind === "system"
              ? component.packages.length
                ? t("updates.packages", { count: component.packages.length })
                : t("updates.noPackages")
              : component.updateAvailable && component.remoteVersion
                ? `${component.version ?? "?"} → ${component.remoteVersion}`
                : (component.version ?? "—")}
          </p>
        </div>
        {component.needsRecovery && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={disabled}
            onClick={onRecover}
          >
            {t("updates.recover")}
          </button>
        )}
        {component.updateAvailable && !component.needsRecovery && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={disabled}
            onClick={onUpgrade}
          >
            {updating ? t("updates.updating") : t("updates.update")}
          </button>
        )}
      </div>
      {component.warnings.length > 0 && (
        <ul className="mt-2 text-xs text-warning">
          {component.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {details > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted hover:text-text">
            {component.kind === "system"
              ? t("updates.showPackages")
              : t("updates.showCommits", { count: details })}
          </summary>
          {component.kind === "system" ? (
            <p className="mt-2 font-mono break-words text-subtle">
              {component.packages.join(", ")}
            </p>
          ) : (
            <ul className="mt-2 grid gap-1.5">
              {component.commitsBehind.map((commit) => (
                <li key={commit.sha} className="flex gap-2">
                  <code className="shrink-0 text-subtle">{commit.sha.slice(0, 7)}</code>
                  <span className="min-w-0 flex-1">
                    {commit.subject}
                    <span className="text-subtle">
                      {[commit.author, commit.date && formatRelativeTime(commit.date)]
                        .filter(Boolean)
                        .map((part) => ` · ${part}`)
                        .join("")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </li>
  );
}
