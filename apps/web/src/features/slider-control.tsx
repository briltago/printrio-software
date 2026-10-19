import { useEffect, useId, useState } from "react";

/** Range slider with a live readout; commits once when the user lets go (pointer up, key up, blur). */
export function SliderControl({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "%",
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [dragging, setDragging] = useState(false);
  // Follow live printer values unless the user is mid-adjustment.
  useEffect(() => {
    if (!dragging) setDraft(value);
  }, [value, dragging]);
  const commit = () => {
    setDragging(false);
    if (draft !== value) onCommit(draft);
  };
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 py-1.5">
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        className="w-full accent-accent"
        onPointerDown={() => setDragging(true)}
        onChange={(event) => {
          setDragging(true);
          setDraft(Number(event.target.value));
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={() => dragging && commit()}
      />
      <output htmlFor={id} className="text-right text-sm font-semibold tabular-nums">
        {draft}
        {unit}
      </output>
    </div>
  );
}
