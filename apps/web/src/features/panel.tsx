import { type ReactNode, useId } from "react";
import { useT } from "../i18n/index.tsx";
import { useStoredState } from "../lib/stored-state.ts";

/** A card with a collapsible body, like Mainsail/Fluidd panels; open state is remembered per browser. */
export function Panel({
  id,
  title,
  actions,
  children,
  className = "",
}: {
  id: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const t = useT();
  const bodyId = useId();
  const [state, setState] = useStoredState<"open" | "closed">(`printrio-panel-${id}`, "open");
  const open = state === "open";
  return (
    <section className={`card ${className}`} aria-label={title}>
      <header className="flex items-center gap-2 px-5 py-1 md:py-3.5">
        <button
          type="button"
          className="flex min-h-11 flex-1 items-center gap-2 text-left text-sm font-semibold md:min-h-0"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={t(open ? "panels.collapse" : "panels.expand", { name: title })}
          onClick={() => setState(open ? "closed" : "open")}
        >
          <span
            aria-hidden="true"
            className={`text-xs text-subtle transition-transform ${open ? "rotate-90" : ""}`}
          >
            ▶
          </span>
          {title}
        </button>
        {open && actions}
      </header>
      <div id={bodyId} hidden={!open} className="border-line border-t px-5 py-4">
        {children}
      </div>
    </section>
  );
}
