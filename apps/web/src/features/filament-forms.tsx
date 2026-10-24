import {
  type FilamentDto,
  type FilamentInput,
  MATERIALS,
  type SpoolDto,
  type SpoolmanImportResult,
} from "@printrio/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Field, FormError } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { filamentLabel, formatGrams, inventoryQuery, parseDecimal } from "../lib/filament.ts";
import { printersQuery } from "../lib/queries.ts";

/** Colour dot of a filament; a dashed ring when the colour is unknown. */
export function Swatch({ color, size = 16 }: { color: string | null; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full border ${color ? "border-line-strong" : "border-line-strong border-dashed"}`}
      style={{ width: size, height: size, background: color ?? "transparent" }}
    />
  );
}

function useInvalidateInventory() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: inventoryQuery.queryKey }),
      queryClient.invalidateQueries({ queryKey: printersQuery.queryKey }),
    ]);
}

function readFilament(form: FormData): FilamentInput {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const color = text("colorHex");
  return {
    vendor: text("vendor") || null,
    name: text("name"),
    material: text("material"),
    colorName: text("colorName") || null,
    colorHex: form.get("hasColor") ? color : null,
    diameter: parseDecimal(form.get("diameter")) ?? 1.75,
    density: parseDecimal(form.get("density")),
    spoolWeight: parseDecimal(form.get("spoolWeight")),
    emptySpoolWeight: parseDecimal(form.get("emptySpoolWeight")),
    price: parseDecimal(form.get("price")),
  };
}

/** `inline`: inside the new-spool form, where weights and price come from the spool fields. */
function FilamentFields({
  filament,
  inline = false,
}: {
  filament?: FilamentDto;
  inline?: boolean;
}) {
  const t = useT();
  const [hasColor, setHasColor] = useState(filament ? filament.colorHex !== null : true);
  const listId = "printrio-materials";
  return (
    <>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field
          label={t("filament.vendor")}
          name="vendor"
          required={false}
          defaultValue={filament?.vendor ?? ""}
          placeholder="Prusament"
        />
        <Field
          label={t("filament.name")}
          name="name"
          defaultValue={filament?.name ?? ""}
          placeholder="Galaxy Black"
        />
        <Field
          label={t("filament.material")}
          name="material"
          list={listId}
          defaultValue={filament?.material ?? "PLA"}
        />
        <datalist id={listId}>
          {MATERIALS.map((material) => (
            <option key={material} value={material} />
          ))}
        </datalist>
        <Field
          label={t("filament.colorName")}
          name="colorName"
          required={false}
          defaultValue={filament?.colorName ?? ""}
        />
      </div>
      <div className="mb-4 flex items-center gap-3 text-sm">
        <label className="flex items-center gap-2 text-muted">
          <input
            type="checkbox"
            name="hasColor"
            checked={hasColor}
            onChange={(event) => setHasColor(event.target.checked)}
          />
          {t("filament.color")}
        </label>
        <input
          type="color"
          name="colorHex"
          aria-label={t("filament.color")}
          className="h-8 w-14 cursor-pointer rounded-[8px] border border-line bg-transparent disabled:opacity-40"
          defaultValue={filament?.colorHex ?? "#7c5ce6"}
          disabled={!hasColor}
        />
      </div>
      <div className={`grid gap-x-4 ${inline ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
        <Field
          label={t("filament.diameter")}
          name="diameter"
          inputMode="decimal"
          defaultValue={String(filament?.diameter ?? 1.75)}
        />
        <Field
          label={t("filament.density")}
          name="density"
          inputMode="decimal"
          required={false}
          defaultValue={filament ? String(filament.density) : ""}
          hint={t("filament.densityHint")}
        />
        {!inline && (
          <>
            <Field
              label={t("filament.price")}
              name="price"
              inputMode="decimal"
              required={false}
              defaultValue={filament?.price != null ? String(filament.price) : ""}
            />
            <Field
              label={t("filament.spoolWeight")}
              name="spoolWeight"
              inputMode="decimal"
              required={false}
              defaultValue={filament?.spoolWeight != null ? String(filament.spoolWeight) : "1000"}
            />
            <Field
              label={t("filament.emptySpoolWeight")}
              name="emptySpoolWeight"
              inputMode="decimal"
              required={false}
              defaultValue={
                filament?.emptySpoolWeight != null ? String(filament.emptySpoolWeight) : ""
              }
              hint={t("filament.emptySpoolHint")}
            />
          </>
        )}
      </div>
    </>
  );
}

function FormButtons({
  pending,
  disabled = false,
  onCancel,
}: {
  pending: boolean;
  disabled?: boolean;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <div className="mt-2 flex justify-end gap-2">
      <button type="button" className="btn btn-secondary" onClick={onCancel}>
        {t("common.cancel")}
      </button>
      <button type="submit" className="btn btn-primary" disabled={pending || disabled}>
        {pending ? t("common.saving") : t("common.save")}
      </button>
    </div>
  );
}

export function FilamentForm({ filament, onDone }: { filament?: FilamentDto; onDone: () => void }) {
  const invalidate = useInvalidateInventory();
  const save = useMutation({
    mutationFn: (body: FilamentInput) =>
      filament
        ? api(`/api/filaments/${filament.id}`, { method: "PATCH", body })
        : api("/api/filaments", { method: "POST", body }),
    onSuccess: async () => {
      await invalidate();
      onDone();
    },
  });
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save.mutate(readFilament(new FormData(event.currentTarget)));
  };
  return (
    <form onSubmit={onSubmit}>
      <FormError error={save.error} />
      <FilamentFields filament={filament} />
      <FormButtons pending={save.isPending} onCancel={onDone} />
    </form>
  );
}

const NEW = "__new";

/** New spool (optionally with a new filament) or edit of an existing one. */
export function SpoolForm({
  spool,
  filaments,
  onDone,
}: {
  spool?: SpoolDto;
  filaments: FilamentDto[];
  onDone: () => void;
}) {
  const t = useT();
  const invalidate = useInvalidateInventory();
  const [filamentId, setFilamentId] = useState(spool?.filamentId ?? filaments[0]?.id ?? NEW);
  const selected = filaments.find((f) => f.id === filamentId);
  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const spoolValues = {
        initialWeight: parseDecimal(form.get("initialWeight")) ?? 0,
        remainingWeight: parseDecimal(form.get("remainingWeight")) ?? undefined,
        emptySpoolWeight: parseDecimal(form.get("spoolEmptyWeight")),
        price: parseDecimal(form.get("spoolPrice")),
        location: String(form.get("location") ?? ""),
        lot: String(form.get("lot") ?? ""),
        notes: String(form.get("notes") ?? ""),
      };
      if (spool) return api(`/api/spools/${spool.id}`, { method: "PATCH", body: spoolValues });
      let id = filamentId;
      if (id === NEW) {
        // A filament created with its first spool takes that spool's weights and price as defaults.
        const created = await api<{ id: string }>("/api/filaments", {
          method: "POST",
          body: {
            ...readFilament(form),
            spoolWeight: spoolValues.initialWeight,
            emptySpoolWeight: spoolValues.emptySpoolWeight,
            price: spoolValues.price,
          },
        });
        id = created.id;
      }
      return api("/api/spools", { method: "POST", body: { ...spoolValues, filamentId: id } });
    },
    onSuccess: async () => {
      await invalidate();
      onDone();
    },
  });
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save.mutate(new FormData(event.currentTarget));
  };

  const defaultWeight = spool?.initialWeight ?? selected?.spoolWeight ?? 1000;
  return (
    <form onSubmit={onSubmit}>
      <FormError error={save.error} />
      {!spool && (
        <label className="mb-4 block text-sm">
          <span className="mb-1.5 block text-muted">{t("filament.filament")}</span>
          <select
            className="input"
            value={filamentId}
            onChange={(event) => setFilamentId(event.target.value)}
          >
            {filaments.map((filament) => (
              <option key={filament.id} value={filament.id}>
                {filamentLabel(filament)}
                {filament.colorName ? ` · ${filament.colorName}` : ""}
              </option>
            ))}
            <option value={NEW}>{t("filament.newFilamentOption")}</option>
          </select>
        </label>
      )}
      {filamentId === NEW && !spool && (
        <fieldset className="mb-4 rounded-card border border-line p-4 pb-0">
          <legend className="px-1 text-xs text-subtle">{t("filament.newFilament")}</legend>
          <FilamentFields inline />
        </fieldset>
      )}
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field
          key={`initial-${filamentId}`}
          label={t("filament.initialWeight")}
          name="initialWeight"
          inputMode="decimal"
          defaultValue={String(defaultWeight)}
        />
        <Field
          key={`remaining-${filamentId}`}
          label={t("filament.remainingWeight")}
          name="remainingWeight"
          inputMode="decimal"
          required={false}
          defaultValue={String(spool?.remainingWeight ?? defaultWeight)}
        />
        <Field
          key={`empty-${filamentId}`}
          label={t("filament.emptySpoolWeight")}
          name="spoolEmptyWeight"
          inputMode="decimal"
          required={false}
          defaultValue={String(spool?.emptySpoolWeight ?? selected?.emptySpoolWeight ?? "")}
        />
        <Field
          key={`price-${filamentId}`}
          label={t("filament.spoolPrice")}
          name="spoolPrice"
          inputMode="decimal"
          required={false}
          defaultValue={String(spool?.price ?? selected?.price ?? "")}
        />
        <Field
          label={t("filament.location")}
          name="location"
          required={false}
          defaultValue={spool?.location ?? ""}
          placeholder={t("filament.locationPlaceholder")}
        />
        <Field
          label={t("filament.lot")}
          name="lot"
          required={false}
          defaultValue={spool?.lot ?? ""}
        />
      </div>
      <label className="mb-4 block text-sm">
        <span className="mb-1.5 block text-muted">{t("filament.notes")}</span>
        <textarea name="notes" className="input min-h-16" defaultValue={spool?.notes ?? ""} />
      </label>
      <FormButtons pending={save.isPending} onCancel={onDone} />
    </form>
  );
}

/** Remaining filament from the gross weight on a scale (spool + filament). */
export function WeighForm({ spool, onDone }: { spool: SpoolDto; onDone: () => void }) {
  const t = useT();
  const invalidate = useInvalidateInventory();
  const [gross, setGross] = useState("");
  const [empty, setEmpty] = useState(
    spool.emptySpoolWeight != null ? String(spool.emptySpoolWeight) : "",
  );
  const grossValue = parseDecimal(gross);
  const emptyValue = parseDecimal(empty);
  const result =
    grossValue !== null && emptyValue !== null ? Math.max(0, grossValue - emptyValue) : null;
  const save = useMutation({
    mutationFn: () =>
      api(`/api/spools/${spool.id}`, {
        method: "PATCH",
        body: { emptySpoolWeight: emptyValue, measuredGrossWeight: grossValue },
      }),
    onSuccess: async () => {
      await invalidate();
      onDone();
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <p className="mb-4 text-sm text-muted">{t("filament.weighHint")}</p>
      <FormError error={save.error} />
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field
          label={t("filament.grossWeight")}
          name="gross"
          inputMode="decimal"
          autoFocus
          value={gross}
          onChange={(event) => setGross(event.target.value)}
        />
        <Field
          label={t("filament.emptySpoolWeight")}
          name="empty"
          inputMode="decimal"
          value={empty}
          onChange={(event) => setEmpty(event.target.value)}
        />
      </div>
      <p className="mb-2 text-sm">
        {t("filament.remainingWeight")}:{" "}
        <strong className="tabular-nums">{result !== null ? formatGrams(result) : "—"}</strong>
      </p>
      <FormButtons pending={save.isPending} disabled={result === null} onCancel={onDone} />
    </form>
  );
}

export function SpoolmanImportForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const invalidate = useInvalidateInventory();
  const [result, setResult] = useState<SpoolmanImportResult | null>(null);
  const run = useMutation({
    mutationFn: (url: string) =>
      api<SpoolmanImportResult>("/api/spools/import/spoolman", { method: "POST", body: { url } }),
    onSuccess: async (data) => {
      setResult(data);
      await invalidate();
    },
  });
  if (result) {
    return (
      <div>
        <p role="status" className="mb-4 text-sm text-success">
          {t("filament.importDone", {
            created: result.spoolsCreated,
            updated: result.spoolsUpdated,
            filaments: result.filaments,
          })}
        </p>
        <div className="flex justify-end">
          <button type="button" className="btn btn-primary" onClick={onDone}>
            {t("common.close")}
          </button>
        </div>
      </div>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run.mutate(String(new FormData(event.currentTarget).get("url") ?? "").trim());
      }}
    >
      <p className="mb-4 text-sm text-muted">{t("filament.importHint")}</p>
      <FormError error={run.error} />
      <Field
        label={t("filament.spoolmanUrl")}
        name="url"
        type="url"
        placeholder="http://spoolman.local:7912"
        autoFocus
      />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={onDone}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="btn btn-primary" disabled={run.isPending}>
          {run.isPending ? t("filament.importing") : t("filament.import")}
        </button>
      </div>
    </form>
  );
}
