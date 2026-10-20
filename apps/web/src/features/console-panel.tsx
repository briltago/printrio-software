import type { ConsoleHistoryDto, MacroListDto } from "@printrio/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { FormError } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { ApiError, api } from "../lib/api.ts";
import { lineTone, pushHistory, stepHistory, suggestCommands } from "../lib/console.ts";
import { appendConsole, clearConsole, seedConsole, useConsole } from "../lib/realtime.ts";
import { Panel } from "./panel.tsx";

const HISTORY_KEY = "printrio-console-history";
const seeded = new Set<string>();

function loadHistory(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveHistory(history: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {}
}

export const macrosQueryKey = (printerId: string) => ["macros", printerId];

/** Macros and firmware commands; shared by the console (autocomplete) and the macro buttons. */
export function useMacros(printerId: string, connected: boolean) {
  return useQuery({
    queryKey: macrosQueryKey(printerId),
    queryFn: () => api<MacroListDto>(`/api/printers/${printerId}/macros`),
    enabled: connected,
    staleTime: 5 * 60_000,
  });
}

const TONE_CLASS = { error: "text-danger", info: "text-subtle", plain: "text-muted" } as const;

/**
 * G-code console: backlog from the printer, live responses, shell-like history
 * (↑/↓, kept per browser) and autocomplete for firmware commands and macros.
 */
export function ConsolePanel({
  printerId,
  connected,
  disabled,
}: {
  printerId: string;
  connected: boolean;
  disabled: boolean;
}) {
  const t = useT();
  const lines = useConsole(printerId);
  const listId = useId();
  const outputRef = useRef<HTMLDivElement>(null);
  const [script, setScript] = useState("");
  const [history, setHistory] = useState(loadHistory);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);

  const backlog = useQuery({
    queryKey: ["console", printerId],
    queryFn: () => api<ConsoleHistoryDto>(`/api/printers/${printerId}/console?count=200`),
    enabled: connected && !seeded.has(printerId),
    staleTime: Number.POSITIVE_INFINITY,
  });
  useEffect(() => {
    if (!backlog.data || seeded.has(printerId)) return;
    seeded.add(printerId);
    seedConsole(
      printerId,
      backlog.data.entries.map(({ kind, message }) => ({ kind, message })),
    );
  }, [backlog.data, printerId]);

  const macros = useMacros(printerId, connected);
  const suggestions = suggestionsOpen ? suggestCommands(script, macros.data?.commands ?? []) : [];
  const activeSuggestion = suggestions[Math.min(active, suggestions.length - 1)];

  const send = useMutation({
    mutationFn: (value: string) =>
      api(`/api/printers/${printerId}/commands`, {
        method: "POST",
        body: { action: "gcode", script: value },
      }),
  });
  // Firmware errors already arrive in the console as "!! …"; only show errors from Printrio itself.
  const sendError = send.error instanceof ApiError && send.error.status === 502 ? null : send.error;

  useEffect(() => {
    const output = outputRef.current;
    if (output && lines.length) output.scrollTop = output.scrollHeight;
  }, [lines]);

  const run = (value: string) => {
    appendConsole(printerId, { kind: "command", message: value });
    send.mutate(value);
    const next = pushHistory(history, value);
    setHistory(next);
    saveHistory(next);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const value = script.trim();
    if (!value) return;
    run(value);
    setScript("");
    setHistoryIndex(null);
  };

  const accept = (name: string) => {
    setScript(`${name} `);
    setActive(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((index) => (index + step + suggestions.length) % suggestions.length);
        return;
      }
      if ((event.key === "Tab" || event.key === "Enter") && activeSuggestion) {
        event.preventDefault();
        accept(activeSuggestion.name);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSuggestionsOpen(false);
        return;
      }
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const step = stepHistory(history, historyIndex, event.key === "ArrowUp" ? "up" : "down");
      if (step.value === null) return;
      event.preventDefault();
      setHistoryIndex(step.index);
      setScript(step.value);
      setSuggestionsOpen(false);
    }
  };

  return (
    <Panel
      id="console"
      title={t("printer.console")}
      actions={
        lines.length > 0 && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => clearConsole(printerId)}
          >
            {t("console.clear")}
          </button>
        )
      }
    >
      <div
        ref={outputRef}
        className="h-64 overflow-auto rounded-[10px] border border-line bg-sidebar p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap"
        role="log"
        aria-live="polite"
        aria-label={t("printer.console")}
      >
        {lines.length === 0 ? (
          <p className="text-subtle">{t("printer.consoleEmpty")}</p>
        ) : (
          lines.map((line, index) =>
            line.kind === "command" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: console lines are append-only and may repeat.
              <div key={index} className="text-accent">
                <span aria-hidden="true">› </span>
                <button
                  type="button"
                  className="text-left hover:underline"
                  title={t("console.reuse")}
                  onClick={() => setScript(line.message)}
                >
                  {line.message}
                </button>
              </div>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: console lines are append-only and may repeat.
              <div key={index} className={TONE_CLASS[lineTone(line.message)]}>
                {line.message}
              </div>
            ),
          )
        )}
      </div>
      <FormError error={sendError} />
      <form onSubmit={onSubmit} className="relative mt-3 flex gap-2">
        {suggestions.length > 0 && (
          <div
            id={listId}
            role="listbox"
            aria-label={t("console.suggestions")}
            className="absolute bottom-full left-0 z-20 mb-2 max-h-72 w-full max-w-md overflow-auto rounded-[12px] border border-line bg-surface p-1 shadow-2xl"
          >
            {suggestions.map((command) => (
              <div
                key={command.name}
                tabIndex={-1}
                id={`${listId}-${command.name}`}
                role="option"
                aria-selected={command === activeSuggestion}
                className={`flex cursor-pointer items-baseline gap-3 rounded-[8px] px-2.5 py-1.5 text-sm ${command === activeSuggestion ? "bg-accent/15 text-text" : "text-muted"}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  accept(command.name);
                }}
              >
                <span className="font-mono font-semibold">{command.name}</span>
                {command.description && (
                  <span className="truncate text-xs text-subtle">{command.description}</span>
                )}
              </div>
            ))}
          </div>
        )}
        <input
          className="input font-mono"
          value={script}
          onChange={(event) => {
            setScript(event.target.value);
            setHistoryIndex(null);
            setSuggestionsOpen(true);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setSuggestionsOpen(false)}
          onFocus={() => setSuggestionsOpen(true)}
          placeholder={t("printer.consolePlaceholder")}
          aria-label={t("printer.consolePlaceholder")}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={suggestions.length > 0}
          aria-controls={listId}
          aria-activedescendant={
            activeSuggestion ? `${listId}-${activeSuggestion.name}` : undefined
          }
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="btn btn-secondary" disabled={disabled || !script.trim()}>
          {t("printer.send")}
        </button>
      </form>
    </Panel>
  );
}
