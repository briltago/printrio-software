import type { Translate } from "../i18n/index.tsx";

export function formatDuration(t: Translate, seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? t("time.hm", { h, m }) : t("time.m", { m });
}

export const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

export function formatFilament(mm: number) {
  return mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${Math.round(mm)} mm`;
}

export const formatTemp = (value: number) => `${value.toFixed(1)}°C`;

/** Human names for Klipper heaters; custom heaters/sensors keep their configured name. */
export function heaterName(t: Translate, name: string) {
  if (name === "extruder") return t("heaters.extruder");
  if (name === "heater_bed") return t("heaters.heater_bed");
  const extra = /^extruder(\d+)$/.exec(name);
  if (extra) return t("heaters.extruderN", { n: Number(extra[1]) + 1 });
  return name.replace(/_/g, " ");
}
