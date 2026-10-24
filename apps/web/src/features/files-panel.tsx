import type { FileListingDto, PrintFileDto } from "@printrio/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type DragEvent, useRef, useState } from "react";
import { Dialog, FormError } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { Icon } from "../icons.tsx";
import { api } from "../lib/api.ts";
import {
  formatBytes,
  formatDuration,
  formatFilamentAmount,
  formatRelativeTime,
} from "../lib/format.ts";
import { useStoredState } from "../lib/stored-state.ts";
import { uploadFile } from "../lib/upload.ts";
import { LibraryPicker } from "./library-send.tsx";
import { Panel } from "./panel.tsx";
import { QueueForm } from "./queue-panel.tsx";

type Sort = "newest" | "name" | "duration";

export const thumbnailUrl = (printerId: string, path: string) =>
  `/api/printers/${printerId}/files/thumbnail?path=${encodeURIComponent(path)}`;

export function Thumbnail({ src, size = 40 }: { src: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-[6px] border border-line bg-field"
      style={{ width: size, height: size }}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          width={size}
          height={size}
          className="h-full w-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-subtle">
          <Icon name="file" size={Math.max(14, Math.round(size * 0.4))} />
        </span>
      )}
    </span>
  );
}

/** G-code files on the printer: browse folders, upload (drag & drop), print, delete. */
export function FilesPanel({
  printerId,
  printerName,
  canPrint,
  connected,
}: {
  printerId: string;
  printerName: string;
  canPrint: boolean;
  connected: boolean;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dir, setDir] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useStoredState<Sort>("printrio-files-sort", "newest");
  const [dragging, setDragging] = useState(false);
  const [upload, setUpload] = useState<{ name: string; progress: number } | null>(null);
  const [confirmFile, setConfirmFile] = useState<PrintFileDto | null>(null);
  const [queueFile, setQueueFile] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const queryKey = ["files", printerId, dir];
  const { data, error } = useQuery({
    queryKey,
    queryFn: () =>
      api<FileListingDto>(`/api/printers/${printerId}/files?dir=${encodeURIComponent(dir)}`),
    enabled: connected,
    retry: false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["files", printerId] });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      setUpload({ name: file.name, progress: 0 });
      await uploadFile(
        `/api/printers/${printerId}/files?dir=${encodeURIComponent(dir)}`,
        file,
        (progress) => setUpload({ name: file.name, progress }),
      );
      return file.name;
    },
    onSuccess: (name) => {
      setNotice(t("files.uploaded", { name }));
      return refresh();
    },
    onSettled: () => setUpload(null),
  });
  const printMutation = useMutation({
    mutationFn: (path: string) =>
      api(`/api/printers/${printerId}/commands`, {
        method: "POST",
        body: { action: "start_print", path },
      }),
    onSuccess: () => setConfirmFile(null),
  });
  const deleteMutation = useMutation({
    mutationFn: (path: string) =>
      api(`/api/printers/${printerId}/files?path=${encodeURIComponent(path)}`, {
        method: "DELETE",
      }),
    onSuccess: refresh,
  });

  const startUploads = (files: FileList | null) => {
    setNotice(null);
    const file = files?.[0];
    if (file) uploadMutation.mutate(file);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    startUploads(event.dataTransfer.files);
  };

  const files = (data?.files ?? [])
    .filter((file) => file.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "duration"
          ? (a.estimatedSeconds ?? 0) - (b.estimatedSeconds ?? 0)
          : b.modified.localeCompare(a.modified),
    );
  const crumbs = dir ? dir.split("/") : [];

  return (
    <Panel
      id="files"
      title={t("files.title")}
      actions={
        <>
          <input
            ref={inputRef}
            type="file"
            accept=".gcode,.g,.gco,.ufp"
            className="hidden"
            onChange={(event) => startUploads(event.target.files)}
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!connected}
            onClick={() => setPicking(true)}
          >
            {t("files.fromLibrary")}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!connected || uploadMutation.isPending}
            onClick={() => inputRef.current?.click()}
          >
            {t("files.upload")}
          </button>
        </>
      }
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop zone is a mouse convenience; the Upload button is the keyboard path. */}
      <div
        className="relative"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-card border-2 border-accent border-dashed bg-accent/10 text-sm font-semibold">
            {t("files.dropHere")}
          </div>
        )}
        <FormError
          error={
            (error as Error | null) ??
            uploadMutation.error ??
            printMutation.error ??
            deleteMutation.error
          }
        />
        <div aria-live="polite">
          {upload && (
            <div className="mb-3">
              <p className="mb-1 text-xs text-muted">
                {t("files.uploading", {
                  name: upload.name,
                  percent: Math.round(upload.progress * 100),
                })}
              </p>
              <div className="progress">
                <span style={{ width: `${Math.round(upload.progress * 100)}%` }} />
              </div>
            </div>
          )}
          {notice && !upload && <p className="mb-3 text-xs text-success">{notice}</p>}
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <nav
            aria-label={t("files.title")}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm"
          >
            <button
              type="button"
              className={crumbs.length ? "text-accent hover:underline" : "font-semibold"}
              onClick={() => setDir("")}
            >
              {t("files.root")}
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
            className="input w-full sm:w-44"
            placeholder={t("files.search")}
            aria-label={t("files.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className="input w-auto"
            aria-label={t("files.sort")}
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
          >
            <option value="newest">{t("files.sortNewest")}</option>
            <option value="name">{t("files.sortName")}</option>
            <option value="duration">{t("files.sortDuration")}</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col" className="w-12" />
                <th scope="col">{t("files.name")}</th>
                <th scope="col" className="hidden sm:table-cell">
                  {t("files.printTime")}
                </th>
                <th scope="col" className="hidden sm:table-cell">
                  {t("files.filament")}
                </th>
                <th scope="col" className="hidden md:table-cell">
                  {t("files.size")}
                </th>
                <th scope="col" className="hidden lg:table-cell">
                  {t("files.modified")}
                </th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {(data?.directories ?? []).map((name) => (
                <tr key={`dir-${name}`}>
                  <td>
                    <span className="grid h-10 w-10 place-items-center text-subtle">
                      <Icon name="library" size={18} />
                    </span>
                  </td>
                  <td colSpan={6}>
                    <button
                      type="button"
                      className="font-semibold hover:underline"
                      onClick={() => setDir(dir ? `${dir}/${name}` : name)}
                    >
                      {name}/
                    </button>
                  </td>
                </tr>
              ))}
              {files.map((file) => (
                <tr key={file.path}>
                  <td>
                    <Thumbnail
                      src={file.hasThumbnail ? thumbnailUrl(printerId, file.path) : null}
                    />
                  </td>
                  <td className="w-full max-w-0">
                    <p className="truncate font-medium" title={file.name}>
                      {file.name}
                    </p>
                    <p className="truncate text-xs text-subtle tabular-nums">
                      <span className="sm:hidden">
                        {formatDuration(t, file.estimatedSeconds)}
                        {file.slicer && " · "}
                      </span>
                      {file.slicer}
                    </p>
                  </td>
                  <td className="hidden whitespace-nowrap tabular-nums sm:table-cell">
                    {formatDuration(t, file.estimatedSeconds)}
                  </td>
                  <td className="hidden whitespace-nowrap tabular-nums sm:table-cell">
                    {formatFilamentAmount(file.filamentGrams, file.filamentMm)}
                  </td>
                  <td className="hidden whitespace-nowrap text-muted tabular-nums md:table-cell">
                    {formatBytes(file.size)}
                  </td>
                  <td className="hidden whitespace-nowrap text-muted lg:table-cell">
                    {formatRelativeTime(file.modified)}
                  </td>
                  <td>
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={!canPrint}
                        title={canPrint ? undefined : t("files.printUnavailable")}
                        onClick={() => setConfirmFile(file)}
                      >
                        {t("files.print")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={!connected}
                        title={t("queue.addTitle")}
                        onClick={() => setQueueFile(file.path)}
                      >
                        {t("queue.queue")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm px-2"
                        aria-label={`${t("common.delete")} ${file.name}`}
                        title={t("common.delete")}
                        onClick={() =>
                          window.confirm(t("files.deleteConfirm", { name: file.name })) &&
                          deleteMutation.mutate(file.path)
                        }
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && files.length === 0 && data.directories.length === 0 && (
            <p className="py-8 text-center text-sm text-muted">{t("files.empty")}</p>
          )}
        </div>
      </div>

      <Dialog
        open={picking}
        onClose={() => setPicking(false)}
        title={t("files.fromLibraryTitle", { printer: printerName })}
      >
        {picking && <LibraryPicker printerId={printerId} onDone={() => setPicking(false)} />}
      </Dialog>
      <Dialog
        open={queueFile !== null}
        onClose={() => setQueueFile(null)}
        title={t("queue.addTitle")}
      >
        {queueFile && (
          <QueueForm printerId={printerId} path={queueFile} onDone={() => setQueueFile(null)} />
        )}
      </Dialog>
      <Dialog
        open={confirmFile !== null}
        onClose={() => setConfirmFile(null)}
        title={t("files.printTitle")}
      >
        {confirmFile && (
          <div>
            <div className="flex gap-4">
              <Thumbnail
                src={confirmFile.hasThumbnail ? thumbnailUrl(printerId, confirmFile.path) : null}
                size={120}
              />
              <div className="min-w-0 text-sm">
                <p className="font-semibold break-words">{confirmFile.name}</p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted">
                  <dt>{t("files.printTime")}</dt>
                  <dd className="text-text">{formatDuration(t, confirmFile.estimatedSeconds)}</dd>
                  <dt>{t("files.filament")}</dt>
                  <dd className="text-text">
                    {formatFilamentAmount(confirmFile.filamentGrams, confirmFile.filamentMm)}
                  </dd>
                  {confirmFile.layerHeight !== null && (
                    <>
                      <dt>{t("files.layerHeight")}</dt>
                      <dd className="text-text">{confirmFile.layerHeight} mm</dd>
                    </>
                  )}
                </dl>
              </div>
            </div>
            <p className="mt-4 text-sm text-muted">
              {t("files.printConfirm", { name: confirmFile.name, printer: printerName })}
            </p>
            <FormError error={printMutation.error} />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmFile(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={printMutation.isPending}
                onClick={() => printMutation.mutate(confirmFile.path)}
              >
                {t("files.printTitle")}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </Panel>
  );
}
