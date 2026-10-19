import type { ReactNode } from "react";

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
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_50%_0%,#7c52ca2e,transparent_55%)] p-4">
      <div className="card w-full max-w-sm rounded-panel p-8">
        <Brand />
        <h1 className="mt-7 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 mb-6 text-sm text-muted">{subtitle}</p>
        {children}
      </div>
    </main>
  );
}

export function Field(props: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  minLength?: number;
}) {
  return (
    <label className="mb-4 block text-sm">
      <span className="mb-1.5 block text-muted">{props.label}</span>
      <input
        className="input"
        name={props.name}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete}
        minLength={props.minLength}
        required
      />
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

export function FormError({ error }: { error: Error | null }) {
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
