import type { LibraryFileDto, LibraryListingDto } from "@printrio/shared";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { type DragEvent, type FormEvent, useRef, useState } from "react";
import { Dialog, EmptyState, FormError, PageHeader, StateBadge } from "../components.tsx";
import { Thumbnail } from "../features/files-panel.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import {
  formatBytes,
  formatDuration,
  formatFilamentAmount,
  formatRelativeTime,
} from "../lib/format.ts";
import { printersQuery } from "../lib/queries.ts";
import { meQuery } from "../lib/session.ts";
import { useStoredState } from "../lib/stored-state.ts";
import { uploadFile } from "../lib/upload.ts";

type Sort = "newest" | "name" | "duration";
const GCODE = /\.(gcode|g|gco)$/i;

export const libraryThumbnailUrl = (path: string) =>
  `/api/library/thumbnail?path=${encodeURIComponent(path)}`;

/**
 * Printrio's own G-code library, stored in the data volume: upload once,
 * then send or print on any printer.
 */
export function LibraryPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: me } = useSuspenseQuery(meQuery);
  const isAdmin = me?.role === "admin";
  const inputRef = useRef<HTMLInputElement>(null);
  const [dir, setDir] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useStoredState<Sort>("printrio-library-sort", "newest");
  const [dragging, setDragging] = useState(false);
  const [upload, setUpload] = useState<{ name: string; progress: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState<LibraryFileDto | null>(null);
  const queryKey = ["library", dir];
  const listing = useQuery({
    queryKey,
    queryFn: () => api<LibraryListingDto>(`/api/library?dir=${encodeURIComponent(dir)}`),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["library"] });

  const uploads = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        setUpload({ name: file.name, progress: 0 });
        await uploadFile(`/api/library?dir=${encodeURIComponent(dir)}`, file, (progress) =>
          setUpload({ name: file.name, progress }),
        );
      }
      return files;
    },
    onSuccess: (files) => {
      setNotice(
        files.length === 1
          ? t("files.uploaded", { name: files[0]?.name ?? "" })
          : t("library.uploadedMany", { count: files.length }),
      );
      return refresh();
    },
    onSettled: () => setUpload(null),
  });
  const folder = useMutation({
    mutationFn: (path: string) => api("/api/library/folders", { method: "POST", body: { path } }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (path: string) =>
      api(`/api/library?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  const startUploads = (list: FileList | null) => {
    const files = [...(list ?? [])].filter((file) => GCODE.test(file.name));
    setNotice(null);
    if (files.length) uploads.mutate(files);
    else if (list?.length) setNotice(t("library.onlyGcode"));
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    startUploads(event.dataTransfer.files);
  };
  const newFolder = () => {
    const name = window.prompt(t("library.folderPrompt"))?.trim();
    if (!name) return;
    if (!/^[^/\\.][^/\\]*$/.test(name)) {
      window.alert(t("library.folderInvalid"));
      return;
    }
    folder.mutate(dir ? `${dir}/${name}` : name);
  };

  const query = search.trim().toLowerCase();
  const files = (listing.data?.files ?? [])
    .filter((file) => !query || file.name.toLowerCase().includes(query))
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "duration"
          ? (a.estimatedSeconds ?? Number.POSITIVE_INFINITY) -
            (b.estimatedSeconds ?? Number.POSITIVE_INFINITY)
          : b.modified.localeCompare(a.modified),
    );
  const directories = (listing.data?.directories ?? []).filter(
    (name) => !query || name.toLowerCase().includes(query),
  );
  const crumbs = dir ? dir.split("/") : [];
  const empty = listing.data && files.length === 0 && directories.length === 0;

  return (
    <main className="mx-auto max-w-6xl p-6 md:p-8">
      <PageHeader
        title={t("nav.files")}
        subtitle={t("library.subtitle")}
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={newFolder}>
              {t("library.newFolder")}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".gcode,.g,.gco"
              multiple
              hidden
              onChange={(event) => {
                startUploads(event.target.files);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={uploads.isPending}
              onClick={() => inputRef.current?.click()}
            >
              {t("files.upload")}
            </button>
          </>
        }
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop zone is a mouse convenience; the Upload button is the keyboard path. */}
      <div
        className="relative mt-6"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[16px] border-2 border-accent border-dashed bg-accent/10 text-sm font-semibold">
            {t("files.dropHere")}
          </div>
        )}
        <div className="card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <nav
              aria-label={t("library.location")}
              className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm"
            >
              <button
                type="button"
                className={crumbs.length ? "text-accent-2 hover:underline" : "font-semibold"}
                onClick={() => setDir("")}
              >
                {t("library.root")}
              </button>
              {crumbs.map((crumb, index) => (
                <span
                  key={crumbs.slice(0, index + 1).join("/")}
                  className="flex items-center gap-1"
                >
                  <span className="text-subtle">/</span>
                  <button
                    type="button"
                    className={
                      index === crumbs.length - 1
                        ? "font-semibold"
                        : "text-accent-2 hover:underline"
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
              className="input w-full py-1.5 text-sm sm:w-52"
              placeholder={t("files.search")}
              aria-label={t("files.search")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              className="input w-auto py-1.5 text-sm"
              aria-label={t("files.sort")}
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
            >
              <option value="newest">{t("files.sortNewest")}</option>
              <option value="name">{t("files.sortName")}</option>
              <option value="duration">{t("files.sortDuration")}</option>
            </select>
          </div>
          {upload && (
            <div className="mb-3" role="status">
              <p className="mb-1 text-xs text-muted">
                {t("files.uploading", { name: upload.name })} {Math.round(upload.progress * 100)} %
              </p>
              <div className="h-1.5 overflow-hidden rounded-full bg-line">
                <div className="h-full bg-accent" style={{ width: `${upload.progress * 100}%` }} />
              </div>
            </div>
          )}
          {notice && (
            <p role="status" className="mb-3 text-sm text-success">
              {notice}
            </p>
          )}
          <FormError error={listing.error ?? uploads.error ?? folder.error ?? remove.error} />
          {empty ? (
            <EmptyState title={t("library.emptyTitle")} text={t("library.emptyText")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-subtle">
                  <tr>
                    <th scope="col" className="w-12 pb-2" />
                    <th scope="col" className="pb-2 font-semibold">
                      {t("files.name")}
                    </th>
                    <th scope="col" className="hidden pb-2 pr-4 font-semibold sm:table-cell">
                      {t("files.printTime")}
                    </th>
                    <th scope="col" className="hidden pb-2 pr-4 font-semibold md:table-cell">
                      {t("files.filament")}
                    </th>
                    <th scope="col" className="hidden pb-2 pr-4 font-semibold lg:table-cell">
                      {t("files.size")}
                    </th>
                    <th scope="col" className="hidden pb-2 pr-4 font-semibold lg:table-cell">
                      {t("files.modified")}
                    </th>
                    <th scope="col" className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {directories.map((name) => {
                    const path = dir ? `${dir}/${name}` : name;
                    return (
                      <tr key={`dir-${name}`} className="border-line border-t">
                        <td className="py-2">
                          <span
                            aria-hidden="true"
                            className="grid h-10 w-10 place-items-center text-accent"
                          >
                            ▣
                          </span>
                        </td>
                        <td className="py-2" colSpan={5}>
                          <button
                            type="button"
                            className="font-medium hover:underline"
                            onClick={() => {
                              setDir(path);
                              setSearch("");
                            }}
                          >
                            {name}/
                          </button>
                        </td>
                        <td className="py-2 text-right">
                          {isAdmin && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm px-2"
                              aria-label={`${t("common.delete")} ${name}`}
                              onClick={() =>
                                window.confirm(t("library.deleteFolderConfirm", { name })) &&
                                remove.mutate(path)
                              }
                            >
                              ✕
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {files.map((file) => (
                    <tr key={file.path} className="border-line border-t">
                      <td className="py-2">
                        <Thumbnail
                          src={file.hasThumbnail ? libraryThumbnailUrl(file.path) : null}
                        />
                      </td>
                      <td className="w-full max-w-0 py-2 pr-2">
                        <p className="truncate font-medium" title={file.name}>
                          {file.name}
                        </p>
                        <p className="truncate text-xs text-subtle">
                          {[file.material, file.slicer, file.uploadedBy]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </td>
                      <td className="hidden py-2 pr-4 whitespace-nowrap tabular-nums sm:table-cell">
                        {formatDuration(t, file.estimatedSeconds)}
                      </td>
                      <td className="hidden py-2 pr-4 whitespace-nowrap tabular-nums md:table-cell">
                        {formatFilamentAmount(file.filamentGrams, file.filamentMm)}
                      </td>
                      <td className="hidden py-2 pr-4 whitespace-nowrap text-muted tabular-nums lg:table-cell">
                        {formatBytes(file.size)}
                      </td>
                      <td className="hidden py-2 pr-4 whitespace-nowrap text-muted lg:table-cell">
                        {formatRelativeTime(file.modified)}
                      </td>
                      <td className="py-2">
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => setSending(file)}
                          >
                            {t("library.send")}
                          </button>
                          <a
                            className="btn btn-secondary btn-sm px-2"
                            href={`/api/library/download?path=${encodeURIComponent(file.path)}`}
                            download
                            aria-label={t("library.download", { name: file.name })}
                            title={t("library.download", { name: file.name })}
                          >
                            ↓
                          </a>
                          {isAdmin && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm px-2"
                              aria-label={`${t("common.delete")} ${file.name}`}
                              onClick={() =>
                                window.confirm(t("files.deleteConfirm", { name: file.name })) &&
                                remove.mutate(file.path)
                              }
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <Dialog
        open={sending !== null}
        onClose={() => setSending(null)}
        title={sending ? t("library.sendTitle", { name: sending.name }) : ""}
      >
        {sending && <SendForm file={sending} onDone={() => setSending(null)} />}
      </Dialog>
    </main>
  );
}

/** Choose a printer; upload the file there and optionally start printing. */
function SendForm({ file, onDone }: { file: LibraryFileDto; onDone: () => void }) {
  const t = useT();
  const { data } = useQuery(printersQuery);
  const printers = data?.printers ?? [];
  const firstIdle = printers.find((p) => p.status.state === "idle" && p.withinLimit);
  const [printerId, setPrinterId] = useState(firstIdle?.id ?? printers[0]?.id ?? "");
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
    onSuccess: (result) =>
      setDone(
        t(result.printing ? "library.sentPrinting" : "library.sent", {
          printer: selected?.name ?? "",
        }),
      ),
  });
  const queue = useMutation({
    mutationFn: () =>
      api(`/api/printers/${printerId}/queue`, {
        method: "POST",
        body: { path: file.path, source: "library" },
      }),
    onSuccess: () => setDone(t("library.queued", { printer: selected?.name ?? "" })),
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
        <div className="flex justify-end">
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
        <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-1 text-sm">
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
      <FormError error={send.error ?? queue.error} />
      {printers.length === 0 ? (
        <p className="mb-4 text-sm text-muted">{t("library.noPrinters")}</p>
      ) : (
        <fieldset className="mb-4">
          <legend className="mb-2 text-sm text-muted">{t("library.printer")}</legend>
          <div className="grid max-h-64 gap-1.5 overflow-auto">
            {printers.map((printer) => (
              <label
                key={printer.id}
                className={`flex cursor-pointer items-center gap-3 rounded-[10px] border px-3 py-2 text-sm ${
                  printer.id === printerId ? "border-accent bg-accent/10" : "border-line"
                }`}
              >
                <input
                  type="radio"
                  name="printer"
                  value={printer.id}
                  checked={printer.id === printerId}
                  onChange={() => setPrinterId(printer.id)}
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
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-secondary mr-auto" onClick={onDone}>
          {t("common.cancel")}
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
