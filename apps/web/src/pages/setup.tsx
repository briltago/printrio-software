import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { AuthCard, Field, FormError, SubmitButton } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";
import { setupStatusQuery } from "../lib/session.ts";

export function SetupPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: status } = useQuery(setupStatusQuery);
  const setup = useMutation({
    mutationFn: (body: Record<string, FormDataEntryValue>) =>
      api("/api/setup", { method: "POST", body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: "/onboarding" });
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setup.mutate(Object.fromEntries(new FormData(event.currentTarget)));
  };

  return (
    <AuthCard title={t("auth.welcomeTitle")} subtitle={t("auth.welcomeSubtitle")}>
      <form onSubmit={onSubmit}>
        <FormError error={setup.error} />
        <Field label={t("auth.name")} name="displayName" autoComplete="name" />
        <Field label={t("auth.email")} name="email" type="email" autoComplete="email" />
        <Field
          label={t("auth.passwordHint")}
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
        />
        {status?.setupCodeRequired && (
          <Field
            label={t("auth.setupCode")}
            name="setupCode"
            hint={t("auth.setupCodeHint")}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        )}
        <SubmitButton pending={setup.isPending}>{t("auth.createAccount")}</SubmitButton>
      </form>
    </AuthCard>
  );
}
