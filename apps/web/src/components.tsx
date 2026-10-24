import type { PrinterState } from "@printrio/shared";
import {
  type InputHTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useT } from "./i18n/index.tsx";
import { isKnownState } from "./lib/fleet.ts";

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
    <main className="grid min-h-screen place-items-center p-4">
      <div className={`card w-full rounded-panel p-6 sm:p-8 ${wide ? "max-w-xl" : "max-w-sm"}`}>
        <Brand />
        <h1 className="mt-6 text-xl font-semibold">{title}</h1>
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
      className="mb-4 rounded-[7px] border border-danger/35 bg-danger/10 px-3 py-2 text-sm text-danger"
    >
      {error.message}
    </p>
  );
}

export function StateBadge({ state }: { state: PrinterState }) {
  const t = useT();
  // A state a newer server reports is shown as it is rather than as a missing translation key.
  const label = isKnownState(state) ? t(`printer.states.${state}`) : String(state);
  return <span className={`badge state-${state}`}>{label}</span>;
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
          <h2 id={titleId} className="mb-5 text-lg font-semibold">
            {title}
          </h2>
          {children}
        </div>
      )}
    </dialog>
  );
}

/**
 * Page title row. `crumbs` is the way back up (e.g. Printers / Voron); `kicker` is a short
 * context label such as the document type, shown before the subtitle (never as an eyebrow).
 */
export function PageHeader({
  kicker,
  crumbs,
  title,
  subtitle,
  actions,
}: {
  kicker?: string;
  crumbs?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  const t = useT();
  // Tier names were used as labels by older modules; they say nothing about the page.
  const context = kicker && !/^Printrio (Pro|Business)$/.test(kicker) ? kicker : undefined;
  return (
    <div>
      {crumbs && (
        <nav
          aria-label={t("nav.breadcrumb")}
          className="mb-2 flex items-center gap-1.5 text-sm text-muted"
        >
          {crumbs}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl leading-tight font-semibold tracking-[-0.01em]">
            {title}
          </h1>
          {(context || subtitle) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              {context && <span className="kicker">{context}</span>}
              {context && subtitle && (
                <span aria-hidden="true" className="text-subtle">
                  ·
                </span>
              )}
              {subtitle}
            </div>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
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
    <div className="mt-6 rounded-card border border-line border-dashed px-6 py-12 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{text}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** A card with a header (title, hint, optional actions) and a body; used for groups of settings. */
export function Section({
  title,
  hint,
  actions,
  children,
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card mb-4 min-w-0 overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-line border-b px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** Radio choices shown as selectable tiles with an optional description and preview. */
export function OptionCards<T extends string>({
  name,
  value,
  options,
  onChange,
  columns = 2,
}: {
  name: string;
  value: T;
  options: { value: T; label: string; description?: string; preview?: ReactNode }[];
  onChange: (value: T) => void;
  columns?: 2 | 3;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-3 ${columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label
            key={option.value}
            className={`flex cursor-pointer flex-col gap-3 rounded-card border p-4 transition-colors ${
              checked
                ? "border-accent bg-accent/10"
                : "border-line hover:border-line-strong hover:bg-surface-2"
            }`}
          >
            {option.preview}
            <span className="flex items-start gap-3">
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="mt-0.5 accent-accent"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{option.label}</span>
                {option.description && (
                  <span className="mt-0.5 block text-xs text-muted">{option.description}</span>
                )}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

export interface ConfirmOptions {
  title: string;
  /** What happens, in one or two sentences: what is removed and what stays. */
  message?: ReactNode;
  confirmLabel: string;
  /** Label of the button that backs out (default "Cancel"); e.g. "Keep" when the action itself is a cancel. */
  cancelLabel?: string;
  /** Red confirm button (default) for deleting, cancelling, stopping. */
  destructive?: boolean;
  /** The real operation; the dialog stays open with its error if it fails. */
  action: () => Promise<unknown> | unknown;
}

/**
 * Confirmation before a consequential action. Cancel is focused first, the
 * confirm button is disabled while the action runs (no double submission) and
 * the dialog only closes once the action succeeded.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = true,
  action,
}: ConfirmOptions & { open: boolean; onClose: () => void }) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  const run = async () => {
    setPending(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure : new Error(String(failure)));
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog open={open} onClose={() => !pending && onClose()} title={title}>
      {message && <div className="text-sm text-muted">{message}</div>}
      <div className="mt-4">
        <FormError error={error} />
      </div>
      {/* Cancel comes first, so the native modal focuses the safe choice. */}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={pending}>
          {cancelLabel ?? t("common.cancel")}
        </button>
        <button
          type="button"
          className={`btn ${destructive ? "btn-danger-solid" : "btn-primary"}`}
          disabled={pending}
          aria-busy={pending}
          onClick={() => void run()}
        >
          {pending ? t("common.working") : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

/** `confirm({...})` opens a ConfirmDialog; render `dialog` once in the component. */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const confirm = useCallback((next: ConfirmOptions) => {
    setOptions(next);
    setOpen(true);
  }, []);
  const dialog = options ? (
    <ConfirmDialog {...options} open={open} onClose={() => setOpen(false)} />
  ) : null;
  return { confirm, dialog };
}
