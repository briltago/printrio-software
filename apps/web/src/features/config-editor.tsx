import type { ConfigBackupDto, ConfigFileContentDto, ConfigFileDto } from "@printrio/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { Dialog, FormError } from "../components.tsx";
import { currentLocale, useT } from "../i18n/index.tsx";
import { ApiError, api } from "../lib/api.ts";
import { formatBytes, formatRelativeTime } from "../lib/format.ts";

const CodeEditor = lazy(() => import("./code-editor.tsx"));

interface Loaded {
  path: string;
  /** What the editor was loaded with (file content or a backup). */
  content: string;
  /** `modified` of the printer's copy the edit is based on; null for a new file. */
  baseModified: string | null;
  /** Saved content on the printer, to tell whether the editor differs from it. */
  savedContent: string;
  /** Changes on every (re)load so the editor remounts with the new document. */
  version: number;
  note?: string;
}

const CONFIG_NAME = /^[\w.-]+(\/[\w.-]+)*\.(cfg|conf)$/;

/** Config files of the printer, with backups in Printrio before every save. */
export function ConfigEditor({ printerId, busy }: { printerId: string; busy: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const files = useQuery({
    queryKey: ["config-files", printerId],
    queryFn: () => api<{ files: ConfigFileDto[] }>(`/api/printers/${printerId}/config/files`),
  });
  const dirty = loaded !== null && (draft ?? loaded.content) !== loaded.savedContent;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const open = useMutation({
    mutationFn: (path: string) =>
      api<ConfigFileContentDto>(
        `/api/printers/${printerId}/config/file?path=${encodeURIComponent(path)}`,
      ),
    onSuccess: (file) => {
      setLoaded((current) => ({
        path: file.path,
        content: file.content,
        savedContent: file.content,
        baseModified: file.modified,
        version: (current?.version ?? 0) + 1,
      }));
      setDraft(null);
      setSaved(null);
    },
  });

  // Open printer.cfg (or the first file) once the list is there.
  const firstPath =
    files.data?.files.find((f) => f.path === "printer.cfg")?.path ?? files.data?.files[0]?.path;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the initial file is opened automatically.
  useEffect(() => {
    if (firstPath && !loaded && !open.isPending) open.mutate(firstPath);
  }, [firstPath]);

  const save = useMutation({
    mutationFn: async ({ restart, force }: { restart: boolean; force: boolean }) => {
      if (!loaded) throw new Error("No file open.");
      const content = draft ?? loaded.content;
      const result = await api<{ modified: string | null }>(
        `/api/printers/${printerId}/config/file`,
        {
          method: "PUT",
          body: { path: loaded.path, content, baseModified: loaded.baseModified, restart, force },
        },
      );
      return { ...result, content, restart };
    },
    onSuccess: (result) => {
      setLoaded((current) =>
        current
          ? {
              ...current,
              content: result.content,
              savedContent: result.content,
              baseModified: result.modified,
              note: undefined,
            }
          : current,
      );
      setDraft(result.content);
      setSaved(t(result.restart ? "config.savedRestarted" : "config.saved"));
      void queryClient.invalidateQueries({ queryKey: ["config-files", printerId] });
      void queryClient.invalidateQueries({ queryKey: ["config-backups", printerId] });
    },
    onError: (error, variables) => {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        !variables.force &&
        error.message.includes("changed") &&
        window.confirm(t("config.conflict"))
      ) {
        save.mutate({ ...variables, force: true });
      }
    },
  });

  const confirmDiscard = () => !dirty || window.confirm(t("config.discard"));

  const switchTo = (path: string) => {
    if (path === loaded?.path || !confirmDiscard()) return;
    open.mutate(path);
  };

  const createFile = () => {
    if (!confirmDiscard()) return;
    const name = window.prompt(t("config.newPrompt"))?.trim();
    if (!name) return;
    if (!CONFIG_NAME.test(name)) {
      window.alert(t("config.invalidName"));
      return;
    }
    if (files.data?.files.some((f) => f.path === name)) {
      open.mutate(name);
      return;
    }
    setLoaded((current) => ({
      path: name,
      content: "",
      savedContent: "",
      baseModified: null,
      version: (current?.version ?? 0) + 1,
      note: t("config.newNote"),
    }));
    setDraft("");
    setSaved(null);
  };

  const loadBackup = (backup: ConfigBackupDto, content: string) => {
    setLoaded((current) =>
      current
        ? {
            ...current,
            content,
            version: current.version + 1,
            note: t("config.backupLoaded", { time: formatRelativeTime(backup.createdAt) }),
          }
        : current,
    );
    setDraft(content);
    setSaved(null);
    setBackupsOpen(false);
  };

  const onSave = (restart: boolean) => {
    if (!loaded || save.isPending) return;
    if (restart && !window.confirm(t("config.restartConfirm"))) return;
    save.mutate({ restart, force: false });
  };

  const conflict = save.error instanceof ApiError && save.error.message.includes("changed");

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <section className="card p-3" aria-label={t("config.files")}>
        <div className="mb-2 flex items-center justify-between px-2">
          <h2 className="text-sm font-semibold">{t("config.files")}</h2>
          <button type="button" className="btn btn-secondary btn-sm" onClick={createFile}>
            {t("config.new")}
          </button>
        </div>
        <FormError error={files.error} />
        <ul className="grid max-h-[30vh] gap-0.5 overflow-auto lg:max-h-[70vh]">
          {(files.data?.files ?? []).map((file) => (
            <li key={file.path}>
              <button
                type="button"
                className={`flex w-full items-baseline justify-between gap-2 rounded-[8px] px-2 py-1.5 text-left text-sm ${
                  loaded?.path === file.path
                    ? "bg-accent/15 font-semibold text-text"
                    : "text-muted hover:bg-surface-2 hover:text-text"
                }`}
                aria-current={loaded?.path === file.path ? "true" : undefined}
                onClick={() => switchTo(file.path)}
              >
                <span className="min-w-0 truncate font-mono">{file.path}</span>
                <span className="shrink-0 text-xs text-subtle">{formatBytes(file.size)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card flex min-w-0 flex-col" aria-label={t("config.editor")}>
        <header className="flex flex-wrap items-center gap-2 border-line border-b px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate font-mono text-sm font-semibold">
            {loaded?.path ?? "…"}
            {dirty && (
              <span className="ml-2 font-sans text-xs font-normal text-warning">
                {t("config.unsaved")}
              </span>
            )}
          </h2>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!loaded || loaded.baseModified === null}
            onClick={() => setBackupsOpen(true)}
          >
            {t("config.backups")}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!loaded || save.isPending}
            onClick={() => onSave(false)}
          >
            {t("config.save")}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!loaded || save.isPending || busy}
            title={busy ? t("config.busy") : undefined}
            onClick={() => onSave(true)}
          >
            {t("config.saveRestart")}
          </button>
        </header>
        {(loaded?.note || saved || (save.error && !conflict) || open.error) && (
          <div className="px-4 pt-3">
            {loaded?.note && <p className="text-sm text-muted">{loaded.note}</p>}
            {saved && (
              <p role="status" className="text-sm text-success">
                {saved}
              </p>
            )}
            <FormError error={conflict ? null : (save.error ?? open.error)} />
          </div>
        )}
        <div className="h-[65vh] min-h-80 p-3">
          {loaded ? (
            <Suspense fallback={<p className="p-3 text-sm text-muted">{t("config.loading")}</p>}>
              <CodeEditor
                key={`${loaded.path}:${loaded.version}`}
                initialValue={loaded.content}
                label={t("config.editorLabel", { path: loaded.path })}
                onChange={(value) => {
                  setDraft(value);
                  setSaved(null);
                }}
                onSave={() => onSave(false)}
              />
            </Suspense>
          ) : (
            <p className="p-3 text-sm text-muted">{t("config.loading")}</p>
          )}
        </div>
        <p className="border-line border-t px-4 py-2 text-xs text-subtle">{t("config.hint")}</p>
      </section>

      {loaded && (
        <BackupsDialog
          open={backupsOpen}
          printerId={printerId}
          path={loaded.path}
          onClose={() => setBackupsOpen(false)}
          onLoad={loadBackup}
        />
      )}
    </div>
  );
}

function BackupsDialog({
  open,
  printerId,
  path,
  onClose,
  onLoad,
}: {
  open: boolean;
  printerId: string;
  path: string;
  onClose: () => void;
  onLoad: (backup: ConfigBackupDto, content: string) => void;
}) {
  const t = useT();
  const backups = useQuery({
    queryKey: ["config-backups", printerId, path],
    queryFn: () =>
      api<{ backups: ConfigBackupDto[] }>(
        `/api/printers/${printerId}/config/backups?path=${encodeURIComponent(path)}`,
      ),
    enabled: open,
  });
  const load = useMutation({
    mutationFn: async (backup: ConfigBackupDto) => {
      const { content } = await api<{ content: string }>(
        `/api/printers/${printerId}/config/backups/${backup.id}`,
      );
      return { backup, content };
    },
    onSuccess: ({ backup, content }) => onLoad(backup, content),
  });

  return (
    <Dialog open={open} onClose={onClose} title={t("config.backupsTitle", { path })}>
      <p className="mb-4 text-sm text-muted">{t("config.backupsHint")}</p>
      <FormError error={backups.error ?? load.error} />
      {backups.data?.backups.length === 0 && (
        <p className="text-sm text-subtle">{t("config.noBackups")}</p>
      )}
      <ul className="grid max-h-[50vh] gap-1 overflow-auto">
        {(backups.data?.backups ?? []).map((backup) => (
          <li
            key={backup.id}
            className="flex items-center gap-3 rounded-[7px] border border-line px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                <time
                  dateTime={backup.createdAt}
                  title={new Date(backup.createdAt).toLocaleString(currentLocale())}
                >
                  {formatRelativeTime(backup.createdAt)}
                </time>
              </p>
              <p className="text-xs text-subtle">
                {[backup.createdBy, formatBytes(backup.size)].filter(Boolean).join(" · ")}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={load.isPending}
              onClick={() => load.mutate(backup)}
            >
              {t("config.loadBackup")}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
