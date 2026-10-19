import type { MacroDto } from "@printrio/shared";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Dialog, FormError } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { macroCall } from "../lib/console.ts";
import { appendConsole } from "../lib/realtime.ts";
import { useMacros } from "./console-panel.tsx";
import { Panel } from "./panel.tsx";

/**
 * One-click buttons for the printer's G-code macros. Macros whose name starts
 * with "_" are helpers and stay hidden (Mainsail/Fluidd convention). Macros with
 * parameters run with their defaults, or with values from the ⋯ dialog.
 */
export function MacrosPanel({
  printerId,
  connected,
  disabled,
}: {
  printerId: string;
  connected: boolean;
  disabled: boolean;
}) {
  const t = useT();
  const { data } = useMacros(printerId, connected);
  const [editing, setEditing] = useState<MacroDto | null>(null);
  const run = useMutation({
    mutationFn: (script: string) => {
      appendConsole(printerId, { kind: "command", message: script });
      return api(`/api/printers/${printerId}/commands`, {
        method: "POST",
        body: { action: "gcode", script },
      });
    },
  });

  const macros = (data?.macros ?? []).filter((macro) => !macro.name.startsWith("_"));
  if (macros.length === 0) return null;

  return (
    <Panel id="macros" title={t("macros.title")}>
      <FormError error={run.error} />
      <div className="flex flex-wrap gap-2">
        {macros.map((macro) => (
          <div key={macro.name} className="inline-flex">
            <button
              type="button"
              className={`btn btn-secondary btn-sm font-mono ${macro.params.length ? "rounded-r-none" : ""}`}
              title={macro.description ?? undefined}
              disabled={disabled || run.isPending}
              onClick={() => run.mutate(macro.name)}
            >
              {macro.name}
            </button>
            {macro.params.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm rounded-l-none border-l-0 px-2"
                aria-label={t("macros.withParams", { name: macro.name })}
                disabled={disabled || run.isPending}
                onClick={() => setEditing(macro)}
              >
                ⋯
              </button>
            )}
          </div>
        ))}
      </div>
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? editing.name : ""}
      >
        {editing && (
          <MacroForm
            macro={editing}
            onRun={(script) => {
              run.mutate(script);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Dialog>
    </Panel>
  );
}

function MacroForm({
  macro,
  onRun,
  onCancel,
}: {
  macro: MacroDto;
  onRun: (script: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>({});
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    onRun(macroCall(macro.name, values));
  };
  return (
    <form onSubmit={onSubmit}>
      {macro.description && <p className="mb-4 text-sm text-muted">{macro.description}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {macro.params.map((param) => (
          <label key={param.name} className="grid gap-1 text-sm">
            <span className="font-mono text-xs font-semibold text-muted">{param.name}</span>
            <input
              className="input font-mono"
              value={values[param.name] ?? ""}
              placeholder={param.defaultValue ?? ""}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) =>
                setValues((current) => ({ ...current, [param.name]: event.target.value }))
              }
            />
          </label>
        ))}
      </div>
      <p className="mt-3 text-xs text-subtle">{t("macros.defaultsHint")}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="btn btn-primary">
          {t("macros.run")}
        </button>
      </div>
    </form>
  );
}
