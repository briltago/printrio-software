import { type PointerEvent, useEffect, useState } from "react";
import { useT } from "../i18n/index.tsx";
import { formatTemp, heaterName } from "../lib/format.ts";
import { HISTORY_WINDOW_MS, type Sample, type SeriesMap } from "../lib/temperature-history.ts";

const HEIGHT = 180;
const PAD = { top: 10, right: 12, bottom: 22, left: 36 };

export const seriesColor = (index: number) => `var(--color-series-${(index % 4) + 1})`;

/**
 * Line chart of the last 20 minutes: solid = actual, dashed = target, one colour
 * per heater in the fixed order of the heater list. Crosshair + tooltip on hover.
 */
export function TemperatureChart({
  series,
  order,
}: {
  series: SeriesMap;
  order: { id: string; name: string }[];
}) {
  const t = useT();
  // Callback ref: the wrapper only exists once there is data, so observe it when it mounts.
  const [wrap, setWrap] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(600);
  const [hoverT, setHoverT] = useState<number | null>(null);

  useEffect(() => {
    if (!wrap) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [wrap]);

  const now = Math.max(Date.now(), ...Object.values(series).map((s) => s.at(-1)?.t ?? 0));
  const start = now - HISTORY_WINDOW_MS;
  const all = order.flatMap(({ id }) => series[id] ?? []).filter((s) => s.t >= start);
  if (all.length < 2)
    return <p className="py-10 text-center text-sm text-subtle">{t("temps.chartEmpty")}</p>;

  const peak = Math.max(...all.map((s) => Math.max(s.value, s.target ?? 0)));
  const yMax = Math.max(50, Math.ceil((peak * 1.08) / 50) * 50);
  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (time: number) => PAD.left + ((time - start) / HISTORY_WINDOW_MS) * plotW;
  const y = (value: number) => PAD.top + plotH - (value / yMax) * plotH;
  const path = (samples: Sample[], pick: (s: Sample) => number | null) => {
    let d = "";
    for (const sample of samples) {
      const value = pick(sample);
      if (value === null) continue;
      d += `${d ? "L" : "M"}${x(sample.t).toFixed(1)},${y(value).toFixed(1)}`;
    }
    return d;
  };
  const yTicks = Array.from({ length: yMax / 50 + 1 }, (_, i) => i * 50).filter(
    (_v, i, list) => list.length <= 7 || i % 2 === 0,
  );
  const xTicks = [20, 15, 10, 5, 0];

  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const time = start + ((event.clientX - rect.left - PAD.left) / plotW) * HISTORY_WINDOW_MS;
    setHoverT(Math.min(now, Math.max(start, time)));
  };
  const nearest = (samples: Sample[] | undefined, time: number) =>
    samples?.reduce<Sample | undefined>(
      (best, s) => (!best || Math.abs(s.t - time) < Math.abs(best.t - time) ? s : best),
      undefined,
    );
  const readout =
    hoverT === null
      ? []
      : order.map((heater, index) => ({
          ...heater,
          index,
          sample: nearest(series[heater.id], hoverT),
        }));
  const tooltipLeft = hoverT === null ? 0 : Math.min(width - 170, Math.max(0, x(hoverT) + 10));

  return (
    <div ref={setWrap} className="relative">
      <svg
        width="100%"
        height={HEIGHT}
        role="img"
        aria-label={t("temps.chart", { minutes: 20 })}
        onPointerMove={onMove}
        onPointerLeave={() => setHoverT(null)}
        className="block touch-none"
      >
        {yTicks.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={PAD.left + plotW}
              y1={y(value)}
              y2={y(value)}
              stroke="var(--color-line)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y(value)}
              dy="0.32em"
              textAnchor="end"
              fontSize={10}
              fill="var(--color-subtle)"
            >
              {value}°
            </text>
          </g>
        ))}
        {xTicks.map((minutes) => (
          <text
            key={minutes}
            x={x(now - minutes * 60_000)}
            y={HEIGHT - 6}
            textAnchor={minutes === 20 ? "start" : minutes === 0 ? "end" : "middle"}
            fontSize={10}
            fill="var(--color-subtle)"
          >
            {minutes === 0 ? t("temps.now") : `−${minutes}m`}
          </text>
        ))}
        {order.map(({ id }, index) => {
          const samples = (series[id] ?? []).filter((s) => s.t >= start);
          return (
            <g
              key={id}
              stroke={seriesColor(index)}
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
            >
              <path
                d={path(samples, (s) => (s.target ? s.target : null))}
                strokeWidth={1.5}
                strokeDasharray="4 4"
                opacity={0.7}
              />
              <path d={path(samples, (s) => s.value)} strokeWidth={2} />
            </g>
          );
        })}
        {hoverT !== null && (
          <line
            x1={x(hoverT)}
            x2={x(hoverT)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke="var(--color-muted)"
            strokeWidth={1}
          />
        )}
      </svg>
      {hoverT !== null && (
        <div
          className="pointer-events-none absolute top-1 w-40 rounded-[10px] border border-line bg-surface-2 p-2.5 text-xs shadow-lg"
          style={{ left: tooltipLeft }}
        >
          <p className="mb-1.5 text-subtle">
            {Math.round((now - hoverT) / 60_000) === 0
              ? t("temps.now")
              : t("temps.minutesAgo", { m: Math.round((now - hoverT) / 60_000) })}
          </p>
          {readout.map(({ id, name, index, sample }) => (
            <p key={id} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-3 rounded"
                style={{ background: seriesColor(index) }}
              />
              <span className="font-semibold text-text">
                {sample ? formatTemp(sample.value) : "—"}
              </span>
              <span className="truncate text-muted">{heaterName(t, name)}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
