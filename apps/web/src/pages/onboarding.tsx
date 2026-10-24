import { sidebarPreset, type UsageMode } from "@printrio/shared";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AuthCard, FormError } from "../components.tsx";
import { PrinterForm } from "../features/printer-form.tsx";
import { useT } from "../i18n/index.tsx";
import { useUpdateSettings } from "../lib/queries.ts";

type Step = "mode" | "printer" | "done";
const STEPS: Step[] = ["mode", "printer", "done"];

/** First-run wizard for the administrator: workspace type, then the first printer. */
export function OnboardingPage() {
  const t = useT();
  const navigate = useNavigate();
  const updateSettings = useUpdateSettings();
  const [step, setStep] = useState<Step>("mode");
  const [mode, setMode] = useState<UsageMode>("single");

  const chooseMode = async () => {
    await updateSettings.mutateAsync({ usageMode: mode, sidebar: sidebarPreset(mode) });
    setStep("printer");
  };
  const finish = async () => {
    await updateSettings.mutateAsync({ onboardingCompleted: true });
    await navigate({ to: "/" });
  };

  const stepLabel = t("onboarding.step", { current: STEPS.indexOf(step) + 1, total: STEPS.length });

  if (step === "mode") {
    return (
      <AuthCard title={t("onboarding.modeTitle")} subtitle={t("onboarding.modeSubtitle")} wide>
        <p className="kicker -mt-3 mb-4">{stepLabel}</p>
        <FormError error={updateSettings.error} />
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">{t("onboarding.modeTitle")}</legend>
          {(
            [
              ["single", t("onboarding.modeSingleTitle"), t("onboarding.modeSingleText"), "▣"],
              ["farm", t("onboarding.modeFarmTitle"), t("onboarding.modeFarmText"), "▦"],
            ] as const
          ).map(([value, title, text, icon]) => (
            <label
              key={value}
              className={`card cursor-pointer p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent-2 ${
                mode === value ? "border-accent bg-accent/10" : "hover:border-line-strong"
              }`}
            >
              <input
                type="radio"
                name="mode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
                className="sr-only"
              />
              <span aria-hidden="true" className="text-xl text-accent">
                {icon}
              </span>
              <span className="mt-2 block font-semibold">{title}</span>
              <span className="mt-1 block text-sm text-muted">{text}</span>
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          className="btn btn-primary mt-6 w-full"
          disabled={updateSettings.isPending}
          onClick={chooseMode}
        >
          {t("common.continue")}
        </button>
      </AuthCard>
    );
  }

  if (step === "printer") {
    return (
      <AuthCard
        title={t("onboarding.printerTitle")}
        subtitle={t("onboarding.printerSubtitle")}
        wide
      >
        <p className="kicker -mt-3 mb-4">{stepLabel}</p>
        <PrinterForm onSaved={() => setStep("done")} submitLabel={t("printer.add")} />
        <button
          type="button"
          className="mt-4 text-sm text-muted underline-offset-4 hover:text-text hover:underline"
          onClick={() => setStep("done")}
        >
          {t("common.skip")}
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("onboarding.doneTitle")} subtitle={t("onboarding.doneText")}>
      <p className="kicker -mt-3 mb-4">{stepLabel}</p>
      <FormError error={updateSettings.error} />
      <button
        type="button"
        className="btn btn-primary w-full"
        disabled={updateSettings.isPending}
        onClick={finish}
      >
        {t("onboarding.openWorkspace")}
      </button>
    </AuthCard>
  );
}
