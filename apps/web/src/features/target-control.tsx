import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useT } from "../i18n/index.tsx";

const STEP = 5;
const MAX = 500;

/** Quick picks per heater kind, in °C (0 = off). */
function quickPicks(heaterId: string) {
  if (heaterId.startsWith("extruder"))
    return [180, 190, 200, 210, 215, 220, 230, 240, 250, 260, 280];
  if (heaterId === "heater_bed") return [45, 50, 55, 60, 65, 70, 80, 90, 100, 110];
  return [30, 40, 50, 60, 70, 80];
}

/**
 * Target temperature: −/+ in 5 °C steps, and a popover with an exact value and
 * quick picks (like Mainsail/Fluidd presets per heater).
 */
export function TargetControl({
  heaterId,
  heaterLabel,
  target,
  disabled,
  onSet,
}: {
  heaterId: string;
  heaterLabel: string;
  target: number;
  disabled: boolean;
  onSet: (value: number) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverId = useId();
  const current = Math.round(target);

  useEffect(() => {
    if (!open) return;
    setDraft(current ? String(current) : "");
    requestAnimationFrame(() => inputRef.current?.select());
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, current]);

  const set = (value: number) => {
    const clamped = Math.min(MAX, Math.max(0, Math.round(value)));
    if (clamped !== current) onSet(clamped);
    setOpen(false);
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(draft || 0);
    if (Number.isFinite(value)) set(value);
  };

  return (
    <div
      ref={rootRef}
      className="relative inline-flex items-stretch rounded-[7px] border border-line-strong bg-sidebar"
    >
      <button
        type="button"
        className="px-2.5 text-muted hover:text-text disabled:opacity-40"
        disabled={disabled || current <= 0}
        aria-label={t("temps.decrease", { name: heaterLabel, step: STEP })}
        onClick={() => set(Math.max(0, current - STEP))}
      >
        −
      </button>
      <button
        type="button"
        className={`min-w-16 border-line border-x px-2 py-1 text-sm font-semibold tabular-nums ${current ? "text-text" : "text-subtle"}`}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-label={t("temps.setTarget", { name: heaterLabel })}
        onClick={() => setOpen((value) => !value)}
      >
        {current ? `${current}°` : t("temps.off")}
      </button>
      <button
        type="button"
        className="px-2.5 text-muted hover:text-text disabled:opacity-40"
        disabled={disabled || current >= MAX}
        aria-label={t("temps.increase", { name: heaterLabel, step: STEP })}
        onClick={() => set(current + STEP)}
      >
        +
      </button>

      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-label={t("temps.setTarget", { name: heaterLabel })}
          className="absolute top-full right-0 z-20 mt-2 w-64 rounded-card border border-line bg-surface p-3 shadow-2xl"
          onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
        >
          <form onSubmit={onSubmit} className="flex gap-2">
            <label className="relative flex-1">
              <span className="sr-only">{t("temps.setTarget", { name: heaterLabel })}</span>
              <input
                ref={inputRef}
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX}
                className="input py-1.5 pr-8 text-right tabular-nums"
                value={draft}
                placeholder="0"
                onChange={(event) => setDraft(event.target.value)}
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-subtle">
                °C
              </span>
            </label>
            <button type="submit" className="btn btn-primary btn-sm">
              {t("temps.apply")}
            </button>
          </form>
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            <button
              type="button"
              className={`rounded-[8px] border px-1.5 py-1 text-xs ${current === 0 ? "border-accent bg-accent/15 text-text" : "border-line text-muted hover:text-text"}`}
              onClick={() => set(0)}
            >
              {t("temps.off")}
            </button>
            {quickPicks(heaterId).map((value) => (
              <button
                key={value}
                type="button"
                className={`rounded-[8px] border px-1.5 py-1 text-xs tabular-nums ${current === value ? "border-accent bg-accent/15 text-text" : "border-line text-muted hover:text-text"}`}
                onClick={() => set(value)}
              >
                {value}°
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
