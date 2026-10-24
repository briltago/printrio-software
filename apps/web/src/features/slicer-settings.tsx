import type { ApiKeyCreatedDto, ApiKeyDto } from "@printrio/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Field, FormError, Section, useConfirm } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { formatRelativeTime } from "../lib/format.ts";
import { printersQuery } from "../lib/queries.ts";

const keysKey = ["api-keys"];

function CopyField({ label, value }: { label: string; value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 truncate text-sm text-muted sm:w-32" title={label}>
        {label}
      </span>
      <code className="min-w-0 flex-1 truncate rounded-[8px] border border-line bg-sidebar px-2.5 py-1.5 text-xs">
        {value}
      </code>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => setCopied(true));
        }}
      >
        {copied ? t("slicer.copied") : t("slicer.copy")}
      </button>
    </div>
  );
}

/**
 * Upload from PrusaSlicer, SuperSlicer, OrcaSlicer or Bambu Studio: Printrio
 * speaks enough of the OctoPrint API for their "physical printer" upload.
 */
export function SlicerSettings() {
  const t = useT();
  const { confirm, dialog } = useConfirm();
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<ApiKeyCreatedDto | null>(null);
  const keys = useQuery({
    queryKey: keysKey,
    queryFn: () => api<{ keys: ApiKeyDto[] }>("/api/api-keys"),
  });
  const { data: printerData } = useQuery(printersQuery);
  const create = useMutation({
    mutationFn: (name: string) =>
      api<ApiKeyCreatedDto>("/api/api-keys", { method: "POST", body: { name } }),
    onSuccess: async (key) => {
      setCreated(key);
      await queryClient.invalidateQueries({ queryKey: keysKey });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keysKey }),
  });
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    create.mutate(String(new FormData(form).get("name") ?? ""), { onSuccess: () => form.reset() });
  };
  const origin = window.location.origin;

  return (
    <>
      <Section title={t("slicer.title")} hint={t("slicer.hint")}>
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>{t("slicer.step1")}</li>
          <li>{t("slicer.step2")}</li>
          <li>{t("slicer.step3")}</li>
        </ol>
        <div className="grid grid-cols-1 gap-2">
          <CopyField label={t("slicer.library")} value={`${origin}/octoprint/library`} />
          {(printerData?.printers ?? []).map((printer) => (
            <CopyField
              key={printer.id}
              label={printer.name}
              value={`${origin}/octoprint/${printer.id}`}
            />
          ))}
        </div>
        <p className="mt-3 text-xs text-subtle">{t("slicer.printerHint")}</p>
      </Section>
      <Section title={t("slicer.keys")} hint={t("slicer.keysHint")}>
        <FormError error={keys.error ?? create.error ?? revoke.error} />
        {created && (
          <div
            role="status"
            className="mb-4 rounded-[7px] border border-success/30 bg-success/10 p-3"
          >
            <p className="mb-2 text-sm text-success">{t("slicer.createdOnce")}</p>
            <CopyField label={created.name} value={created.key} />
          </div>
        )}
        <form onSubmit={onSubmit} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field
              label={t("slicer.keyName")}
              name="name"
              placeholder={t("slicer.keyNamePlaceholder")}
            />
          </div>
          <button type="submit" className="btn btn-primary mb-4" disabled={create.isPending}>
            {t("slicer.createKey")}
          </button>
        </form>
        {keys.data?.keys.length === 0 && (
          <p className="text-sm text-subtle">{t("slicer.noKeys")}</p>
        )}
        <ul className="grid grid-cols-1 gap-2">
          {(keys.data?.keys ?? []).map((key) => (
            <li
              key={key.id}
              className="flex items-center gap-3 rounded-[7px] border border-line px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{key.name}</p>
                <p className="text-xs text-subtle">
                  <code>{key.prefix}…</code> ·{" "}
                  {key.lastUsedAt
                    ? t("slicer.lastUsed", { time: formatRelativeTime(key.lastUsedAt) })
                    : t("slicer.neverUsed")}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  confirm({
                    title: t("confirm.revokeTitle", { name: key.name }),
                    message: t("confirm.revoke"),
                    confirmLabel: t("slicer.revoke"),
                    action: () => revoke.mutateAsync(key.id),
                  })
                }
              >
                {t("slicer.revoke")}
              </button>
            </li>
          ))}
        </ul>
      </Section>
      {dialog}
    </>
  );
}
