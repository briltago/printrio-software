import type { PrinterStatusDto, TemperatureHistoryDto } from "@printrio/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "./api.ts";

export const HISTORY_WINDOW_MS = 20 * 60 * 1000;
const SAMPLE_MS = 1000;

export interface Sample {
  t: number;
  value: number;
  target: number | null;
}
export type SeriesMap = Record<string, Sample[]>;

/** Seeds from Moonraker's temperature store, then appends live readings (≤ 1 sample/s, 20-minute window). */
export function useTemperatureHistory(
  printerId: string,
  temperatures: PrinterStatusDto["temperatures"],
  enabled: boolean,
) {
  const [series, setSeries] = useState<SeriesMap>({});
  const { data } = useQuery({
    queryKey: ["temperature-history", printerId],
    queryFn: () => api<TemperatureHistoryDto>(`/api/printers/${printerId}/temperatures`),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  useEffect(() => {
    if (!data) return;
    const now = Date.now();
    const seeded: SeriesMap = {};
    for (const entry of data.series) {
      const length = entry.temperatures.length;
      seeded[entry.id] = entry.temperatures.map((value, i) => ({
        t: now - (length - 1 - i) * data.intervalSeconds * 1000,
        value,
        target: entry.targets?.[i] ?? null,
      }));
    }
    setSeries(seeded);
  }, [data]);

  useEffect(() => {
    const now = Date.now();
    setSeries((previous) => {
      let changed = false;
      const next: SeriesMap = { ...previous };
      for (const temp of temperatures) {
        const samples = previous[temp.id] ?? [];
        const last = samples.at(-1);
        if (last && now - last.t < SAMPLE_MS) continue;
        next[temp.id] = [
          ...samples.filter((s) => now - s.t <= HISTORY_WINDOW_MS),
          { t: now, value: temp.current, target: temp.target },
        ];
        changed = true;
      }
      return changed ? next : previous;
    });
  }, [temperatures]);

  return series;
}
