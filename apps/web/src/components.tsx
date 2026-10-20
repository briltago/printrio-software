import type { PrinterState } from "@printrio/shared";
import { type InputHTMLAttributes, type ReactNode, useEffect, useId, useRef } from "react";
import { useT } from "./i18n/index.tsx";

export function Brand({ size = 30 }: { size?: number }) {
  return (
    <span className="brand" style={{ fontSize: size * 0.68 }}>
      <img src="/logo.webp" alt="" width={size} height={size} />
      printrio
    </span>
  );
}

export function AuthCard({
  title,
  subtitle,
  children,
  wide = false,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_50%_0%,#7c52ca2e,transparent_55%)] p-4">
      <div className={`card w-full rounded-panel p-8 ${wide ? "max-w-xl" : "max-w-sm"}`}>
        <Brand />
        <h1 className="mt-7 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 mb-6 text-sm text-muted">{subtitle}</p>
        {children}
      </div>
    </main>
  );
}

type FieldProps = {
  label: string;
  name: string;
  hint?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "name">;

export function Field({ label, name, hint, type = "text", required = true, ...input }: FieldProps) {
  const hintId = useId();
  return (
    <label className="mb-4 block text-sm">
      <span className="mb-1.5 block text-muted">{label}</span>
      <input
        className="input"
        name={name}
        type={type}
        required={required}
        aria-describedby={hint ? hintId : undefined}
        {...input}
      />
      {hint && (
        <span id={hintId} className="mt-1 block text-xs text-subtle">
          {hint}
        </span>
      )}
    </label>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button type="submit" disabled={pending} className="btn btn-primary mt-2 w-full">
      {children}
    </button>
  );
}

export function FormError({ error }: { error: Error | null | undefined }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="mb-4 rounded-[9px] border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
    >
      {error.message}
    </p>
  );
}

export function StateBadge({ state }: { state: PrinterState }) {
  const t = useT();
  return <span className={`badge state-${state}`}>{t(`printer.states.${state}`)}</span>;
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Native <dialog> as a modal: focus trapping, Escape and backdrop come from the browser. */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a mouse shortcut; keyboard users close with Escape (native <dialog>).
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="p-6">
          <h2 id={titleId} className="mb-5 text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function PageHeader({
  kicker,
  title,
  subtitle,
  actions,
}: {
  kicker?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {kicker && <p className="kicker">{kicker}</p>}
        <h1 className="mt-1 truncate text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="card mt-6 px-6 py-14 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{text}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** A card with a title and hint, used for groups of settings. */
export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="card mb-4 p-5">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
