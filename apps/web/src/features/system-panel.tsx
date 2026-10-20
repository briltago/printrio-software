import type { HostServiceDto, RestartRequest } from "@printrio/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FormError } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { Panel } from "./panel.tsx";

const SERVICE_STATE_CLASS: Record<string, string> = {
  active: "state-idle",
  failed: "state-error",
};

/** Restarts (Klipper, firmware, host services) and host power. */
export function SystemPanel({ printerId, busy }: { printerId: string; busy: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [done, setDone] = useState<string | null>(null);
  const services = useQuery({
    queryKey: ["services", printerId],
    queryFn: () => api<{ services: HostServiceDto[] }>(`/api/printers/${printerId}/services`),
  });
  const restart = useMutation({
    mutationFn: (body: RestartRequest) =>
      api(`/api/printers/${printerId}/restart`, { method: "POST", body }),
    onMutate: () => setDone(null),
    onSuccess: (_, body) => {
      setDone(t("system.sent"));
      if (body.target === "service")
        setTimeout(
          () => void queryClient.invalidateQueries({ queryKey: ["services", printerId] }),
          3000,
        );
    },
  });
  const confirmThen = (message: string, body: RestartRequest) => {
    if (window.confirm(message)) restart.mutate(body);
  };
  const disabled = busy || restart.isPending;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel id="maintenance-restarts" title={t("system.restarts")}>
        {busy && <p className="mb-3 text-sm text-warning">{t("system.busy")}</p>}
        <FormError error={restart.error} />
        {done && (
          <p role="status" className="mb-3 text-sm text-success">
            {done}
          </p>
        )}
        <div className="grid gap-3">
          <ActionRow
            title={t("system.restartKlipper")}
            text={t("system.restartKlipperText")}
            label={t("system.restart")}
            disabled={disabled}
            onClick={() => confirmThen(t("system.restartKlipperConfirm"), { target: "klipper" })}
          />
          <ActionRow
            title={t("system.restartFirmware")}
            text={t("system.restartFirmwareText")}
            label={t("system.restart")}
            disabled={disabled}
            onClick={() => confirmThen(t("system.restartFirmwareConfirm"), { target: "firmware" })}
          />
          <ActionRow
            title={t("system.reboot")}
            text={t("system.rebootText")}
            label={t("system.rebootAction")}
            disabled={disabled}
            onClick={() =>
              confirmThen(t("system.rebootConfirm"), { target: "host", action: "reboot" })
            }
          />
          <ActionRow
            title={t("system.shutdown")}
            text={t("system.shutdownText")}
            label={t("system.shutdownAction")}
            danger
            disabled={disabled}
            onClick={() =>
              confirmThen(t("system.shutdownConfirm"), { target: "host", action: "shutdown" })
            }
          />
        </div>
      </Panel>

      <Panel id="maintenance-services" title={t("system.services")}>
        <FormError error={services.error} />
        <ul className="grid gap-2">
          {(services.data?.services ?? []).map((service) => (
            <li
              key={service.name}
              className="flex items-center gap-3 rounded-[10px] border border-line px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-sm">{service.name}</span>
              {service.state && (
                <span className={`badge ${SERVICE_STATE_CLASS[service.state] ?? "state-offline"}`}>
                  {service.state}
                </span>
              )}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={disabled}
                onClick={() =>
                  confirmThen(t("system.restartServiceConfirm", { name: service.name }), {
                    target: "service",
                    service: service.name,
                  })
                }
              >
                {t("system.restart")}
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function ActionRow({
  title,
  text,
  label,
  danger = false,
  disabled,
  onClick,
}: {
  title: string;
  text: string;
  label: string;
  danger?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-subtle">{text}</p>
      </div>
      <button
        type="button"
        className={`btn btn-sm ${danger ? "btn-danger" : "btn-secondary"}`}
        disabled={disabled}
        onClick={onClick}
      >
        {label}
      </button>
    </div>
  );
}
