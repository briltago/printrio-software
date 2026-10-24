import type { LibraryFileDto, LibraryListingDto } from "@printrio/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { FormError, StateBadge } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons.tsx";
import { api } from "../lib/api.ts";
import { formatDuration, formatFilamentAmount } from "../lib/format.ts";
import { printersQuery } from "../lib/queries.ts";
import { Thumbnail } from "./files-panel.tsx";
import { queueKey } from "./queue-panel.tsx";

export const libraryThumbnailUrl = (path: string) =>
  `/api/library/thumbnail?path=${encodeURIComponent(path)}`;

/**
 * Upload a library file to a printer, optionally starting it, or add it to that
 * printer's queue. Without `printerId` the printer is chosen in the form.
 */
export function SendForm({
  file,
  printerId: fixedPrinterId,
  onDone,
  onBack,
}: {
  file: LibraryFileDto;
  printerId?: string;
  onDone: () => void;
  /** Shown instead of Cancel when the form was opened from a file list. */
  onBack?: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data } = useQuery(printersQuery);
  const printers = data?.printers ?? [];
  const firstIdle = printers.find((p) => p.status.state === "idle" && p.withinLimit);
  const [chosen, setChosen] = useState(firstIdle?.id ?? printers[0]?.id ?? "");
  const printerId = fixedPrinterId ?? chosen;
  const [print, setPrint] = useState(true);
  const selected = printers.find((p) => p.id === printerId);
  const canPrint = selected?.status.state === "idle" && selected.withinLimit;
  const [done, setDone] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () =>
      api<{ printing: boolean }>("/api/library/send", {
        method: "POST",
        body: { path: file.path, printerId, print: print && canPrint },
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["files", printerId] });
      setDone(
        t(result.printing ? "library.sentPrinting" : "library.sent", {
          printer: selected?.name ?? "",
        }),
      );
    },
  });
  const queue = useMutation({
    mutationFn: () =>
      api(`/api/printers/${printerId}/queue`, {
        method: "POST",
        body: { path: file.path, source: "library" },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queueKey(printerId) });
      setDone(t("library.queued", { printer: selected?.name ?? "" }));
    },
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send.mutate();
  };

  if (done)
    return (
      <div>
        <p role="status" className="mb-4 text-sm text-success">
          {done}
        </p>
        <div className="flex justify-end gap-2">
          {/* From the Library: one step to watch the print instead of finding the printer again. */}
          {!fixedPrinterId && selected && (
            <Link
              to="/printers/$printerId"
              params={{ printerId: selected.id }}
              className="btn btn-secondary"
              onClick={onDone}
            >
              {t("library.openPrinter", { printer: selected.name })}
            </Link>
          )}
          <button type="button" className="btn btn-primary" onClick={onDone}>
            {t("common.close")}
          </button>
        </div>
      </div>
    );

  return (
    <form onSubmit={onSubmit}>
      <div className="mb-4 flex gap-4">
        <Thumbnail src={file.hasThumbnail ? libraryThumbnailUrl(file.path) : null} size={88} />
        <div className="min-w-0">
          {fixedPrinterId && <p className="mb-2 font-semibold break-words">{file.name}</p>}
          <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1 text-sm">
            <dt className="text-subtle">{t("files.printTime")}</dt>
            <dd className="tabular-nums">{formatDuration(t, file.estimatedSeconds)}</dd>
            <dt className="text-subtle">{t("files.filament")}</dt>
            <dd className="tabular-nums">
              {formatFilamentAmount(file.filamentGrams, file.filamentMm)}
            </dd>
            {file.material && (
              <>
                <dt className="text-subtle">{t("filament.material")}</dt>
                <dd>{file.material}</dd>
              </>
            )}
          </dl>
        </div>
      </div>
      <FormError error={send.error ?? queue.error} />
      {fixedPrinterId ? null : printers.length === 0 ? (
        <p className="mb-4 text-sm text-muted">{t("library.noPrinters")}</p>
      ) : (
        <fieldset className="mb-4">
          <legend className="mb-2 text-sm text-muted">{t("library.printer")}</legend>
          <div className="grid max-h-64 gap-1.5 overflow-auto">
            {printers.map((printer) => (
              <label
                key={printer.id}
                className={`flex cursor-pointer items-center gap-3 rounded-[7px] border px-3 py-2 text-sm ${
                  printer.id === printerId ? "border-accent bg-accent/10" : "border-line"
                }`}
              >
                <input
                  type="radio"
                  name="printer"
                  value={printer.id}
                  checked={printer.id === printerId}
                  onChange={() => setChosen(printer.id)}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{printer.name}</span>
                <StateBadge state={printer.status.state} />
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label className={`mb-4 flex items-center gap-2 text-sm ${canPrint ? "" : "text-subtle"}`}>
        <input
          type="checkbox"
          checked={print && canPrint}
          disabled={!canPrint}
          onChange={(event) => setPrint(event.target.checked)}
        />
        {canPrint ? t("library.startPrinting") : t("library.cannotPrint")}
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-secondary mr-auto" onClick={onBack ?? onDone}>
          {onBack ? t("common.back") : t("common.cancel")}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!selected || queue.isPending}
          onClick={() => queue.mutate()}
        >
          {t("library.addToQueue")}
        </button>
        <button type="submit" className="btn btn-primary" disabled={!selected || send.isPending}>
          {send.isPending
            ? t("library.sending")
            : print && canPrint
              ? t("library.sendAndPrint")
              : t("library.sendOnly")}
        </button>
      </div>
    </form>
  );
}

/** Browse the library and send a file to one printer (printer page → Files → From library). */
export function LibraryPicker({ printerId, onDone }: { printerId: string; onDone: () => void }) {
  const t = useT();
  const [dir, setDir] = useState("");
  const [search, setSearch] = useState("");
  const [file, setFile] = useState<LibraryFileDto | null>(null);
  const listing = useQuery({
    queryKey: ["library", dir],
    queryFn: () => api<LibraryListingDto>(`/api/library?dir=${encodeURIComponent(dir)}`),
  });

  if (file)
    return (
      <SendForm file={file} printerId={printerId} onDone={onDone} onBack={() => setFile(null)} />
    );

  const query = search.trim().toLowerCase();
  const files = (listing.data?.files ?? [])
    .filter((entry) => !query || entry.name.toLowerCase().includes(query))
    .sort((a, b) => b.modified.localeCompare(a.modified));
  const directories = (listing.data?.directories ?? []).filter(
    (name) => !query || name.toLowerCase().includes(query),
  );
  const crumbs = dir ? dir.split("/") : [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <nav
          aria-label={t("library.location")}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm"
        >
          <button
            type="button"
            className={crumbs.length ? "text-accent hover:underline" : "font-semibold"}
            onClick={() => setDir("")}
          >
            {t("library.root")}
          </button>
          {crumbs.map((crumb, index) => (
            <span key={crumbs.slice(0, index + 1).join("/")} className="flex items-center gap-1">
              <span className="text-subtle">/</span>
              <button
                type="button"
                className={
                  index === crumbs.length - 1 ? "font-semibold" : "text-accent hover:underline"
                }
                onClick={() => setDir(crumbs.slice(0, index + 1).join("/"))}
              >
                {crumb}
              </button>
            </span>
          ))}
        </nav>
        <input
          type="search"
          className="input w-full sm:w-48"
          placeholder={t("files.search")}
          aria-label={t("files.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <FormError error={listing.error} />
      <ul className="-mx-1 max-h-[min(24rem,55dvh)] overflow-y-auto">
        {directories.map((name) => (
          <li key={`dir-${name}`}>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-[7px] px-1 py-1.5 text-left text-sm hover:bg-surface-2"
              onClick={() => {
                setDir(dir ? `${dir}/${name}` : name);
                setSearch("");
              }}
            >
              <span className="grid h-10 w-10 place-items-center text-subtle">
                <Icon name="library" size={18} />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
              <Icon name="chevron" size={14} />
            </button>
          </li>
        ))}
        {files.map((entry) => (
          <li key={entry.path}>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-[7px] px-1 py-1.5 text-left text-sm hover:bg-surface-2"
              onClick={() => setFile(entry)}
            >
              <Thumbnail src={entry.hasThumbnail ? libraryThumbnailUrl(entry.path) : null} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium" title={entry.name}>
                  {entry.name}
                </span>
                <span className="block truncate text-xs text-subtle tabular-nums">
                  {[
                    formatDuration(t, entry.estimatedSeconds),
                    formatFilamentAmount(entry.filamentGrams, entry.filamentMm),
                    entry.material,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {listing.data && files.length === 0 && directories.length === 0 && (
        <p className="py-8 text-center text-sm text-muted">
          {query ? t("files.noMatch") : t("library.emptyTitle")}
        </p>
      )}
      <div className="mt-4 flex justify-end">
        <button type="button" className="btn btn-secondary" onClick={onDone}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
