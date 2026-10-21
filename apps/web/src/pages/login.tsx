import type { SsoPublicDto } from "@printrio/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { AuthCard, Field, FormError, SubmitButton } from "../components.tsx";
import { useT } from "../i18n/index.tsx";
import { api } from "../lib/api.ts";

export function LoginPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const login = useMutation({
    mutationFn: (body: Record<string, FormDataEntryValue>) =>
      api("/api/auth/login", { method: "POST", body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: "/" });
    },
  });

  const sso = useQuery({ queryKey: ["sso"], queryFn: () => api<SsoPublicDto>("/api/auth/sso") });
  // Back from the identity provider with a reason it did not work.
  const ssoError = new URLSearchParams(window.location.search).get("sso_error");

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    login.mutate(Object.fromEntries(new FormData(event.currentTarget)));
  };

  return (
    <AuthCard title={t("auth.signInTitle")} subtitle={t("auth.signInSubtitle")}>
      {ssoError && <FormError error={new Error(ssoError)} />}
      {sso.data?.enabled && (
        <>
          <a className="btn btn-primary mb-4 flex w-full justify-center" href="/api/auth/sso/start">
            {t("auth.ssoButton", { label: sso.data.label })}
          </a>
          <p className="mb-4 text-center text-xs text-subtle">{t("auth.or")}</p>
        </>
      )}
      <form onSubmit={onSubmit}>
        <FormError error={login.error} />
        <Field label={t("auth.email")} name="email" type="email" autoComplete="email" />
        <Field
          label={t("auth.password")}
          name="password"
          type="password"
          autoComplete="current-password"
        />
        <SubmitButton pending={login.isPending}>{t("auth.signIn")}</SubmitButton>
      </form>
    </AuthCard>
  );
}
