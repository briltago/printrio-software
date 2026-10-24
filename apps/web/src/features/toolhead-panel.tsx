import type { Axis, MotionStatusDto, PrinterCommand, PrinterState } from "@printrio/shared";
import { useMutation } from "@tanstack/react-query";
import { FormError } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { useStoredState } from "../lib/stored-state.ts";
import { Panel } from "./panel.tsx";

const XY_STEPS = ["0.1", "1", "10", "50", "100"] as const;
const Z_STEPS = ["0.01", "0.1", "1", "10"] as const;

/** Position, homing, jogging and motors off — like Mainsail's toolhead panel. */
export function ToolheadPanel({
  printerId,
  motion,
  state,
}: {
  printerId: string;
  motion: MotionStatusDto;
  state: PrinterState;
}) {
  const t = useT();
  const [xyStep, setXyStep] = useStoredState<(typeof XY_STEPS)[number]>("printrio-jog-xy", "10");
  const [zStep, setZStep] = useStoredState<(typeof Z_STEPS)[number]>("printrio-jog-z", "1");
  const command = useMutation({
    mutationFn: (body: PrinterCommand) =>
      api(`/api/printers/${printerId}/commands`, { method: "POST", body }),
  });
  // Moving the head during a print ruins it; homing/jogging are only offered when idle.
  const locked = state === "printing" || state === "paused";
  const disabled = locked || state !== "idle" || command.isPending;
  const homed = new Set(motion.homedAxes);

  const jogButton = (axis: Axis, sign: 1 | -1, label: string) => {
    const distance = sign * Number(axis === "z" ? zStep : xyStep);
    return (
      <button
        type="button"
        className="btn btn-secondary btn-sm min-w-12 justify-center font-mono"
        disabled={disabled}
        aria-label={t("motion.jog", { axis: axis.toUpperCase(), distance })}
        title={!homed.has(axis) ? t("motion.notHomed", { axis: axis.toUpperCase() }) : undefined}
        onClick={() => command.mutate({ action: "jog", axis, distance })}
      >
        {label}
      </button>
    );
  };

  return (
    <Panel id="toolhead" title={t("motion.title")}>
      <FormError error={command.error} />
      <dl className="grid grid-cols-3 gap-2" aria-label={t("motion.position")}>
        {(["x", "y", "z"] as const).map((axis) => (
          <div key={axis} className="rounded-[7px] border border-line bg-sidebar px-3 py-2">
            <dt className="flex items-center justify-between text-xs text-subtle">
              {axis.toUpperCase()}
              {!homed.has(axis) && (
                <span
                  className="text-warning"
                  title={t("motion.notHomed", { axis: axis.toUpperCase() })}
                >
                  ⌂?
                </span>
              )}
            </dt>
            <dd
              className={`font-mono text-lg font-semibold tabular-nums ${homed.has(axis) ? "" : "text-subtle"}`}
            >
              {motion.position[axis].toFixed(axis === "z" ? 2 : 1)}
            </dd>
          </div>
        ))}
      </dl>

      {locked ? (
        <p className="mt-4 text-sm text-muted">{t("motion.lockedWhilePrinting")}</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-start gap-6">
            <div className="grid grid-cols-3 gap-1.5">
              <span />
              {jogButton("y", 1, "Y+")}
              <span />
              {jogButton("x", -1, "X−")}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={disabled}
                onClick={() => command.mutate({ action: "home", axes: ["x", "y"] })}
              >
                ⌂ XY
              </button>
              {jogButton("x", 1, "X+")}
              <span />
              {jogButton("y", -1, "Y−")}
              <span />
            </div>
            <div className="grid gap-1.5">
              {jogButton("z", 1, "Z+")}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={disabled}
                onClick={() => command.mutate({ action: "home", axes: ["z"] })}
              >
                ⌂ Z
              </button>
              {jogButton("z", -1, "Z−")}
            </div>
            <div className="grid gap-1.5">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={disabled}
                onClick={() => command.mutate({ action: "home", axes: [] })}
              >
                {t("motion.homeAll")}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={disabled}
                onClick={() => command.mutate({ action: "motors_off" })}
              >
                {t("motion.motorsOff")}
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <StepPicker
              label={t("motion.stepXY")}
              steps={XY_STEPS}
              value={xyStep}
              onChange={setXyStep}
            />
            <StepPicker
              label={t("motion.stepZ")}
              steps={Z_STEPS}
              value={zStep}
              onChange={setZStep}
            />
          </div>
        </>
      )}
    </Panel>
  );
}

function StepPicker<T extends string>({
  label,
  steps,
  value,
  onChange,
}: {
  label: string;
  steps: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-xs text-subtle">{label}</legend>
      <div className="seg flex">
        {steps.map((step) => (
          <button
            key={step}
            type="button"
            aria-pressed={step === value}
            onClick={() => onChange(step)}
            className="flex-1 justify-center font-mono text-xs"
          >
            {step}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
