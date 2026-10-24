import type { LogFileDto, LogTailDto } from "@printrio/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { FormError } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { formatBytes, formatRelativeTime } from "../lib/format.ts";

const PROBLEM = /error|exception|shutdown|traceback|failed|!!/i;
const MAX_RENDERED_LINES = 5000;

/** Host logs (klippy.log, moonraker.log, …): the end of the file with filters, and a full download. */
export function LogsViewer({ printerId }: { printerId: string }) {
  const t = useT();
  const [name, setName] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);

  const logs = useQuery({
    queryKey: ["logs", printerId],
    queryFn: () => api<{ logs: LogFileDto[] }>(`/api/printers/${printerId}/logs`),
  });
  const selected =
    name ?? logs.data?.logs.find((l) => l.name === "klippy.log")?.name ?? logs.data?.logs[0]?.name;
  const log = useQuery({
    queryKey: ["log", printerId, selected],
    queryFn: () =>
      api<LogTailDto>(
        `/api/printers/${printerId}/logs/file?name=${encodeURIComponent(selected ?? "")}`,
      ),
    enabled: Boolean(selected),
  });

  const { lines, total } = useMemo(() => {
    const all = (log.data?.content ?? "").split("\n");
    if (all.at(-1) === "") all.pop();
    const query = filter.trim().toLowerCase();
    const matching = all.filter(
      (line) =>
        (!problemsOnly || PROBLEM.test(line)) && (!query || line.toLowerCase().includes(query)),
    );
    return { lines: matching.slice(-MAX_RENDERED_LINES), total: matching.length };
  }, [log.data, filter, problemsOnly]);

  useEffect(() => {
    const output = outputRef.current;
    if (output && lines.length) output.scrollTop = output.scrollHeight;
  }, [lines]);

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <section className="card p-3" aria-label={t("logs.files")}>
        <h2 className="mb-2 px-2 text-sm font-semibold">{t("logs.files")}</h2>
        <FormError error={logs.error} />
        <ul className="grid max-h-[30vh] gap-0.5 overflow-auto lg:max-h-[70vh]">
          {(logs.data?.logs ?? []).map((file) => (
            <li key={file.name}>
              <button
                type="button"
                className={`w-full rounded-[8px] px-2 py-1.5 text-left text-sm ${
                  selected === file.name
                    ? "bg-accent/15 font-semibold text-text"
                    : "text-muted hover:bg-surface-2 hover:text-text"
                }`}
                aria-current={selected === file.name ? "true" : undefined}
                onClick={() => setName(file.name)}
              >
                <span className="block truncate font-mono">{file.name}</span>
                <span className="text-xs font-normal text-subtle">
                  {formatBytes(file.size)} · {formatRelativeTime(file.modified)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card flex min-w-0 flex-col" aria-label={t("logs.viewer")}>
        <header className="flex flex-wrap items-center gap-2 border-line border-b px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate font-mono text-sm font-semibold">
            {selected ?? "…"}
          </h2>
          <input
            type="search"
            className="input w-full py-1.5 text-sm sm:w-56"
            placeholder={t("logs.filter")}
            aria-label={t("logs.filter")}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={problemsOnly}
              onChange={(event) => setProblemsOnly(event.target.checked)}
            />
            {t("logs.problemsOnly")}
          </label>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={log.isFetching}
            onClick={() => void log.refetch()}
          >
            {t("logs.refresh")}
          </button>
          {selected && (
            <a
              className="btn btn-secondary btn-sm"
              href={`/api/printers/${printerId}/logs/file?name=${encodeURIComponent(selected)}&download=1`}
              download
            >
              {t("logs.download")}
            </a>
          )}
        </header>
        <div className="px-4 pt-3">
          <FormError error={log.error} />
          {log.data?.truncated && <p className="text-xs text-subtle">{t("logs.truncated")}</p>}
          {(filter || problemsOnly) && log.data && (
            <p className="text-xs text-subtle">{t("logs.matching", { count: total })}</p>
          )}
        </div>
        <pre
          ref={outputRef}
          className="m-3 h-[65vh] min-h-80 overflow-auto rounded-[7px] border border-line bg-sidebar p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-muted"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region must be reachable by keyboard.
          tabIndex={0}
        >
          {log.isPending && selected
            ? t("config.loading")
            : lines.map((line, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: log lines are static and may repeat.
                <span key={index} className={PROBLEM.test(line) ? "text-danger" : undefined}>
                  {line}
                  {"\n"}
                </span>
              ))}
        </pre>
      </section>
    </div>
  );
}
