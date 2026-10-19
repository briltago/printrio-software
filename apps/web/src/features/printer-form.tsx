import type { ConnectionTestResult, Printer, PrinterInput, PrinterUpdate } from "@printrio/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import { Field, FormError } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { groupsQuery, printersQuery } from "../lib/queries.ts";

const parseTags = (value: string) => [
  ...new Set(
    value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  ),
];

/** Add or edit a printer, with a live connection test. */
export function PrinterForm({
  printer,
  onSaved,
  onCancel,
  submitLabel,
}: {
  printer?: Printer;
  onSaved: (printer: Printer) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const { data: groups } = useQuery(groupsQuery);
  const [removeKey, setRemoveKey] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const readForm = () => {
    const data = new FormData(formRef.current ?? undefined);
    const apiKey = String(data.get("apiKey") ?? "").trim();
    return {
      name: String(data.get("name") ?? ""),
      url: String(data.get("url") ?? "").trim(),
      apiKey,
      groupId: String(data.get("groupId") ?? "") || null,
      tags: parseTags(String(data.get("tags") ?? "")),
    };
  };

  const test = useMutation({
    mutationFn: () => {
      const { url, apiKey } = readForm();
      return api<ConnectionTestResult>("/api/printers/test", {
        method: "POST",
        body: { url, apiKey: apiKey || null },
      });
    },
    onMutate: () => setTestResult(null),
    onSuccess: setTestResult,
  });

  const save = useMutation({
    mutationFn: () => {
      const { apiKey, ...rest } = readForm();
      if (!printer) {
        const body: PrinterInput = { ...rest, apiKey: apiKey || null };
        return api<Printer>("/api/printers", { method: "POST", body });
      }
      const body: PrinterUpdate = { ...rest };
      if (apiKey) body.apiKey = apiKey;
      else if (removeKey) body.apiKey = null;
      return api<Printer>(`/api/printers/${printer.id}`, { method: "PATCH", body });
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: printersQuery.queryKey });
      onSaved(saved);
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <form ref={formRef} onSubmit={onSubmit}>
      <FormError error={save.error} />
      <Field
        label={t("printer.name")}
        name="name"
        placeholder={t("printer.namePlaceholder")}
        defaultValue={printer?.name}
        maxLength={80}
        autoComplete="off"
      />
      <Field
        label={t("printer.url")}
        name="url"
        type="url"
        placeholder="http://192.168.1.50:7125"
        hint={t("printer.urlHint")}
        defaultValue={printer?.url}
        autoComplete="off"
      />
      <Field
        label={t("printer.apiKey")}
        name="apiKey"
        type="password"
        required={false}
        autoComplete="off"
        placeholder={printer?.hasApiKey ? t("printer.apiKeyKeep") : undefined}
        hint={t("printer.apiKeyHint")}
      />
      {printer?.hasApiKey && (
        <label className="-mt-2 mb-4 flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={removeKey}
            onChange={(event) => setRemoveKey(event.target.checked)}
          />
          {t("printer.removeApiKey")}
        </label>
      )}
      <div className="grid gap-x-4 sm:grid-cols-2">
        <label className="mb-4 block text-sm">
          <span className="mb-1.5 block text-muted">{t("printer.group")}</span>
          <select name="groupId" className="input" defaultValue={printer?.groupId ?? ""}>
            <option value="">{t("printer.noGroup")}</option>
            {groups?.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <Field
          label={t("printer.tags")}
          name="tags"
          required={false}
          hint={t("printer.tagsHint")}
          defaultValue={printer?.tags.join(", ")}
        />
      </div>

      <div aria-live="polite">
        {testResult && (
          <p
            className={`mb-4 rounded-[9px] border px-3 py-2 text-sm ${
              testResult.ok
                ? "border-success/30 bg-success/10 text-success"
                : "border-danger/30 bg-danger/10 text-danger"
            }`}
          >
            {testResult.ok
              ? t("printer.testOk", {
                  hostname: testResult.hostname ?? "printer",
                  state: testResult.klippyState ?? "unknown",
                })
              : t("printer.testFailed", { error: testResult.error ?? "unknown error" })}
          </p>
        )}
        {test.error && <FormError error={test.error} />}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={test.isPending}
          onClick={() => formRef.current?.reportValidity() && test.mutate()}
        >
          {test.isPending ? t("printer.testing") : t("printer.testConnection")}
        </button>
        <div className="flex gap-2">
          {onCancel && (
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              {t("common.cancel")}
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? t("common.saving") : (submitLabel ?? t("common.save"))}
          </button>
        </div>
      </div>
    </form>
  );
}
