import type { MotionStatusDto, PrinterCommand } from "@printrio/shared";
import { useMutation } from "@tanstack/react-query";
import { FormError } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { Panel } from "./panel.tsx";
import { SliderControl } from "./slider-control.tsx";

const Z_DELTAS = [-0.05, -0.01, 0.01, 0.05];

/** Live adjustments that are safe during a print: babystepping, speed, flow, part fan. */
export function TuningPanel({
  printerId,
  motion,
  connected,
}: {
  printerId: string;
  motion: MotionStatusDto;
  connected: boolean;
}) {
  const t = useT();
  const command = useMutation({
    mutationFn: (body: PrinterCommand) =>
      api(`/api/printers/${printerId}/commands`, { method: "POST", body }),
  });
  const disabled = !connected || command.isPending;
  const percent = (factor: number) => Math.round(factor * 100);

  return (
    <Panel id="tuning" title={t("tuning.title")}>
      <FormError error={command.error} />
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <span className="w-[5.5rem] text-sm text-muted">{t("tuning.zOffset")}</span>
        <span className="min-w-20 font-mono text-sm font-semibold tabular-nums">
          {motion.zOffset >= 0 ? "+" : ""}
          {motion.zOffset.toFixed(3)} mm
        </span>
        <div className="flex flex-wrap gap-1">
          {Z_DELTAS.map((delta) => (
            <button
              key={delta}
              type="button"
              className="btn btn-secondary btn-sm px-2 font-mono"
              disabled={disabled}
              aria-label={t("tuning.zOffsetStep", { delta })}
              onClick={() => command.mutate({ action: "z_offset", delta })}
            >
              {delta > 0 ? "+" : "−"}
              {Math.abs(delta)}
            </button>
          ))}
          {motion.zOffset !== 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={disabled}
              onClick={() => command.mutate({ action: "z_offset", delta: -motion.zOffset })}
            >
              {t("tuning.reset")}
            </button>
          )}
        </div>
      </div>
      <div className="border-line border-t pt-2">
        <SliderControl
          label={t("tuning.speed")}
          value={percent(motion.speedFactor)}
          min={10}
          max={300}
          step={5}
          disabled={disabled}
          onCommit={(value) => command.mutate({ action: "speed_factor", factor: value / 100 })}
        />
        <SliderControl
          label={t("tuning.flow")}
          value={percent(motion.flowFactor)}
          min={50}
          max={150}
          disabled={disabled}
          onCommit={(value) => command.mutate({ action: "flow_factor", factor: value / 100 })}
        />
        {motion.fanSpeed !== null && (
          <SliderControl
            label={t("tuning.fan")}
            value={percent(motion.fanSpeed)}
            min={0}
            max={100}
            step={5}
            disabled={disabled}
            onCommit={(value) => command.mutate({ action: "fan_speed", speed: value / 100 })}
          />
        )}
      </div>
    </Panel>
  );
}
