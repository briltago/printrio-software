import type { PrinterCommand, PrinterStatusDto } from "@printrio/shared";
import { useMutation } from "@tanstack/react-query";
import { FormError, useConfirm } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";

/** Klipper exclude_object: skip a failed part without stopping the whole plate. */
export function ObjectExclusion({
  printerId,
  exclusion,
}: {
  printerId: string;
  exclusion: NonNullable<PrinterStatusDto["exclusion"]>;
}) {
  const t = useT();
  const { confirm, dialog } = useConfirm();
  const command = useMutation({
    mutationFn: (body: PrinterCommand) =>
      api(`/api/printers/${printerId}/commands`, { method: "POST", body }),
  });
  const excluded = new Set(exclusion.excluded);
  return (
    <div className="mt-5 border-line border-t pt-4">
      <h3 className="mb-2 text-xs font-semibold text-subtle">{t("exclusion.title")}</h3>
      <FormError error={command.error} />
      <ul className="grid gap-1.5">
        {exclusion.objects.map((name) => {
          const isExcluded = excluded.has(name);
          return (
            <li
              key={name}
              className="flex items-center justify-between gap-3 rounded-[9px] border border-line px-3 py-1.5 text-sm"
            >
              <span
                className={`truncate font-mono text-xs ${isExcluded ? "text-subtle line-through" : ""}`}
              >
                {name}
              </span>
              <span className="flex items-center gap-2">
                {exclusion.current === name && !isExcluded && (
                  <span className="badge state-printing">{t("exclusion.current")}</span>
                )}
                {isExcluded ? (
                  <span className="text-xs text-subtle">{t("exclusion.excluded")}</span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm py-1"
                    disabled={command.isPending}
                    onClick={() =>
                      confirm({
                        title: t("confirm.skipTitle", { name }),
                        message: t("confirm.skip"),
                        confirmLabel: t("exclusion.exclude"),
                        action: () => command.mutateAsync({ action: "exclude_object", name }),
                      })
                    }
                  >
                    {t("exclusion.exclude")}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {dialog}
    </div>
  );
}
