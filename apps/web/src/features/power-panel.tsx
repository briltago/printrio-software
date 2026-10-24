import type { PowerDeviceDto } from "@printrio/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormError, useConfirm } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { Panel } from "./panel.tsx";

/** Power outlets and relays configured in Moonraker (`[power …]`); hidden when there are none. */
export function PowerPanel({
  printerId,
  connected,
  busy,
}: {
  printerId: string;
  connected: boolean;
  busy: boolean;
}) {
  const t = useT();
  const { confirm, dialog } = useConfirm();
  const queryClient = useQueryClient();
  const queryKey = ["power", printerId];
  const devices = useQuery({
    queryKey,
    queryFn: () => api<{ devices: PowerDeviceDto[] }>(`/api/printers/${printerId}/power`),
    enabled: connected,
    refetchInterval: 15_000,
  });
  const toggle = useMutation({
    mutationFn: (body: { device: string; on: boolean }) =>
      api(`/api/printers/${printerId}/power`, { method: "POST", body }),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const list = devices.data?.devices ?? [];
  if (list.length === 0) return null;

  return (
    <Panel id="power" title={t("power.title")}>
      <FormError error={toggle.error} />
      <ul className="grid gap-2">
        {list.map((device) => {
          const on = device.state === "on";
          const locked = busy && device.lockedWhilePrinting;
          const pending = toggle.isPending && toggle.variables?.device === device.name;
          return (
            <li key={device.name} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{device.name}</p>
                <p className="text-xs text-subtle">
                  {locked
                    ? t("power.locked")
                    : on || device.state === "off"
                      ? t(on ? "power.on" : "power.off")
                      : device.state}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={t("power.toggle", { name: device.name })}
                disabled={locked || pending}
                className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${
                  on ? "border-accent bg-accent" : "border-line-strong bg-sidebar"
                }`}
                onClick={() =>
                  on
                    ? confirm({
                        title: t("confirm.powerTitle", { name: device.name }),
                        message: t("confirm.power"),
                        confirmLabel: t("power.switchOff"),
                        action: () => toggle.mutateAsync({ device: device.name, on: false }),
                      })
                    : toggle.mutate({ device: device.name, on: true })
                }
              >
                <span
                  aria-hidden="true"
                  className={`absolute top-0.5 left-0 size-4.5 rounded-full bg-white shadow transition-transform ${
                    on ? "translate-x-5.5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ul>
      {dialog}
    </Panel>
  );
}
