import type { PrinterCommand, PrinterStatusDto } from "@printrio/shared";
import { useMutation } from "@tanstack/react-query";
import { FormError } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { formatTemp, heaterName } from "../lib/format.ts";
import { useStoredState } from "../lib/stored-state.ts";
import { useTemperatureHistory } from "../lib/temperature-history.ts";
import { Panel } from "./panel.tsx";
import { TargetControl } from "./target-control.tsx";
import { seriesColor, TemperatureChart } from "./temperature-chart.tsx";

/** Chart windows; 1 minute is a live view, longer ranges show trends. */
const RANGES = [
  { id: "1m", label: "1 min", ms: 60_000 },
  { id: "10m", label: "10 min", ms: 10 * 60_000 },
  { id: "20m", label: "20 min", ms: 20 * 60_000 },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

/** Material presets: nozzle / bed targets in °C. */
const PRESETS = [
  { name: "PLA", extruder: 210, bed: 60 },
  { name: "PETG", extruder: 240, bed: 80 },
  { name: "ABS", extruder: 255, bed: 100 },
] as const;

export function TemperaturePanel({
  printerId,
  temperatures,
  connected,
}: {
  printerId: string;
  temperatures: PrinterStatusDto["temperatures"];
  connected: boolean;
}) {
  const t = useT();
  const series = useTemperatureHistory(printerId, temperatures, connected);
  const [rangeId, setRangeId] = useStoredState<RangeId>("printrio-temp-range", "1m");
  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[0];
  const command = useMutation({
    mutationFn: (body: PrinterCommand) =>
      api(`/api/printers/${printerId}/commands`, { method: "POST", body }),
  });
  const setTarget = (heater: string, target: number) =>
    command.mutate({ action: "set_temperature", heater, target });
  const heaters = temperatures.filter((temp) => temp.controllable);
  const applyPreset = (extruder: number, bed: number) => {
    for (const heater of heaters) {
      if (heater.id.startsWith("extruder")) setTarget(heater.id, extruder);
      else if (heater.id === "heater_bed") setTarget(heater.id, bed);
    }
  };

  return (
    <Panel
      id="temperatures"
      title={t("temps.title")}
      actions={
        <fieldset className="flex rounded-[9px] border border-line p-0.5">
          <legend className="sr-only">{t("temps.range")}</legend>
          {RANGES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={option.id === range.id}
              onClick={() => setRangeId(option.id)}
              className={`tap rounded-[7px] px-2 py-0.5 text-[11px] font-semibold ${option.id === range.id ? "bg-accent/15 text-text" : "text-muted hover:text-text"}`}
            >
              {option.label}
            </button>
          ))}
        </fieldset>
      }
    >
      <FormError error={command.error} />
      {temperatures.length === 0 ? (
        <p className="text-sm text-muted">—</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-subtle">
            <tr>
              <th scope="col" className="pb-2 text-left font-semibold">
                {t("temps.heater")}
              </th>
              <th scope="col" className="pb-2 text-right font-semibold">
                {t("temps.actual")}
              </th>
              <th scope="col" className="w-36 pb-2 text-right font-semibold">
                {t("temps.target")}
              </th>
            </tr>
          </thead>
          <tbody>
            {temperatures.map((temp, index) => (
              <tr key={temp.id} className="border-line border-t">
                <th scope="row" className="py-2 text-left font-normal text-muted">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-0.5 w-3.5 rounded"
                      style={{ background: seriesColor(index) }}
                    />
                    <span>
                      {heaterName(t, temp.name)}
                      {temp.power !== null && (temp.target ?? 0) > 0 && (
                        <span
                          className="mt-1 block h-[3px] w-14 overflow-hidden rounded-full bg-line"
                          aria-hidden="true"
                          title={`${t("temps.power", { name: heaterName(t, temp.name) })}: ${Math.round(temp.power * 100)} %`}
                        >
                          <span
                            className="block h-full rounded-full bg-warning"
                            style={{ width: `${Math.round(temp.power * 100)}%` }}
                          />
                        </span>
                      )}
                      {temp.power !== null && (temp.target ?? 0) > 0 && (
                        <span className="sr-only">
                          {t("temps.power", { name: heaterName(t, temp.name) })}:{" "}
                          {Math.round(temp.power * 100)} %
                        </span>
                      )}
                    </span>
                  </span>
                </th>
                <td className="py-2 text-right text-base font-semibold tabular-nums">
                  {formatTemp(temp.current)}
                </td>
                <td className="py-2 text-right">
                  {temp.controllable ? (
                    <TargetControl
                      heaterId={temp.id}
                      heaterLabel={heaterName(t, temp.name)}
                      target={temp.target ?? 0}
                      disabled={!connected}
                      onSet={(value) => setTarget(temp.id, value)}
                    />
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {heaters.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-subtle">{t("temps.presets")}</span>
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={!connected}
              onClick={() => applyPreset(preset.extruder, preset.bed)}
              title={`${preset.extruder}° / ${preset.bed}°`}
            >
              {preset.name}
            </button>
          ))}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!connected}
            onClick={() => applyPreset(0, 0)}
          >
            {t("temps.cooldown")}
          </button>
        </div>
      )}

      <div className="mt-4">
        <TemperatureChart
          series={series}
          order={temperatures.map(({ id, name }) => ({ id, name }))}
          windowMs={range.ms}
        />
      </div>
    </Panel>
  );
}
