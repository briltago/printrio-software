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

/** "fan" is Klipper's part cooling fan; other fans keep their configured name, tidied up. */
export function fanName(t: Translate, id: string, name: string) {
  if (id === "fan") return t("tuning.partFan");
  const words = name.replace(/_/g, " ").replace(/([a-z])(\d+)$/i, "$1 $2");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Filament: grams when the slicer reports them, otherwise length. */
export const formatFilamentAmount = (grams: number | null, mm: number | null) =>
  grams !== null
    ? `${grams.toFixed(grams < 10 ? 1 : 0)} g`
    : mm !== null
      ? formatFilament(mm)
      : "—";

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
/** "3 hours ago", "yesterday", … — dates older than a month are shown in full. */
export function formatRelativeTime(iso: string, now = Date.now()) {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 30],
  ];
  let value = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return relative.format(Math.round(value), unit);
    value /= size;
  }
  return new Date(iso).toLocaleDateString("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
