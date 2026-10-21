import type { BackupDto, BackupKind, BackupsDto } from "@printrio/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type FormEvent, useRef, useState } from "react";
import { FormError, Section } from "../components.tsx";
import { currentLocale, useT } from "../i18n/index.tsx";
import { ApiError, api } from "../lib/api.ts";
import { formatBytes } from "../lib/format.ts";

const KEY = ["settings", "backups"];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** Waits until the server answers again after a restore, then reloads the app. */
async function waitForRestart() {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (res.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  window.location.reload();
}

/** Settings → Backups: download, restore and schedule backups of the whole instance. */
export function BackupSettings() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data, error } = useQuery({
    queryKey: KEY,
    queryFn: () => api<BackupsDto>("/api/backups"),
  });
  const [includeFiles, setIncludeFiles] = useState(false);
  const [restoring, setRestoring] = useState<BackupDto | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: KEY });
  const create = useMutation({
    mutationFn: () => api<BackupDto>("/api/backups", { method: "POST", body: { includeFiles } }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (name: string) =>
      api(`/api/backups/${encodeURIComponent(name)}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const restore = useMutation({
    mutationFn: (name: string) =>
      api(`/api/backups/${encodeURIComponent(name)}/restore`, { method: "POST" }),
    onSuccess: () => void waitForRestart(),
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/backups/upload", {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, body?.error ?? `Upload failed (${res.status})`);
      return body as BackupDto;
    },
    onSuccess: refresh,
  });
  if (!data) return <FormError error={error} />;

  const kindLabel = (kind: BackupKind) => t(`backups.kinds.${kind}`);
  const onUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) upload.mutate(file);
    event.target.value = "";
  };

  return (
    <>
      {!data.available && (
        <p className="mb-5 rounded-[10px] border border-warning/40 bg-warning/10 p-3 text-sm">
          {t("backups.unavailable")}
        </p>
      )}
      <Section title={t("backups.title")} hint={t("backups.hint", { directory: data.directory })}>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!data.available || create.isPending || restore.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? t("backups.creating") : t("backups.create")}
          </button>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={includeFiles}
              onChange={(event) => setIncludeFiles(event.target.checked)}
            />
            {t("backups.includeFiles")}
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={upload.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {upload.isPending ? t("backups.uploading") : t("backups.upload")}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".gz,.tar.gz,application/gzip"
            hidden
            onChange={onUpload}
          />
        </div>
        <FormError error={create.error ?? remove.error ?? upload.error} />
        {data.backups.length === 0 ? (
          <p className="mt-5 text-sm text-subtle">{t("backups.empty")}</p>
        ) : (
          <ul className="mt-5 divide-y divide-line">
            {data.backups.map((backup) => (
              <li key={backup.name} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-40 flex-1">
                  <p className="text-sm font-semibold">
                    {new Date(backup.createdAt).toLocaleString(currentLocale())}
                  </p>
                  <p className="text-xs text-subtle">
                    {kindLabel(backup.kind)} · Printrio {backup.version} ·{" "}
                    {formatBytes(backup.size)}
                  </p>
                </div>
                <a
                  className="btn btn-secondary btn-sm"
                  href={`/api/backups/${encodeURIComponent(backup.name)}/download`}
                  download
                >
                  {t("backups.download")}
                </a>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={!data.available}
                  onClick={() => setRestoring(backup)}
                >
                  {t("backups.restore")}
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() =>
                    window.confirm(t("backups.deleteConfirm")) && remove.mutate(backup.name)
                  }
                >
                  {t("common.delete")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {restoring && (
        <Section
          title={t("backups.restoreTitle")}
          hint={t("backups.restoreHint", {
            date: new Date(restoring.createdAt).toLocaleString(currentLocale()),
          })}
        >
          {restore.isSuccess ? (
            <p className="text-sm text-muted">{t("backups.restarting")}</p>
          ) : (
            <>
              <FormError error={restore.error} />
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(restoring.name)}
                >
                  {restore.isPending ? t("backups.restoring") : t("backups.restoreConfirm")}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={restore.isPending}
                  onClick={() => setRestoring(null)}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </>
          )}
        </Section>
      )}
      <ScheduleSection settings={data.settings} />
    </>
  );
}

function ScheduleSection({ settings }: { settings: BackupsDto["settings"] }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (body: BackupsDto["settings"]) =>
      api("/api/backups/settings", { method: "PUT", body }),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setSaved(false);
    save.mutate({
      enabled: f.get("enabled") === "on",
      hour: Number(f.get("hour")),
      keep: Number(f.get("keep")),
      includeFiles: f.get("includeFiles") === "on",
    });
  };
  return (
    <Section title={t("backups.scheduleTitle")} hint={t("backups.scheduleHint")}>
      <form onSubmit={submit} onChange={() => setSaved(false)} className="grid gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={settings.enabled} />
          {t("backups.scheduleEnabled")}
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1.5 block text-muted">{t("backups.hour")}</span>
            <select name="hour" className="input" defaultValue={settings.hour}>
              {HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {`${String(hour).padStart(2, "0")}:00`}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-muted">{t("backups.keep")}</span>
            <input
              name="keep"
              className="input"
              type="number"
              min={1}
              max={90}
              defaultValue={settings.keep}
              required
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="includeFiles" defaultChecked={settings.includeFiles} />
          {t("backups.includeFiles")}
        </label>
        <FormError error={save.error} />
        <div>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {saved ? t("common.saved") : t("common.save")}
          </button>
        </div>
      </form>
    </Section>
  );
}
