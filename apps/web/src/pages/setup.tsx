import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { AuthCard, Field, FormError, SubmitButton } from "../components.tsx";
import { api } from "../lib/api.ts";

export function SetupPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const setup = useMutation({
    mutationFn: (body: Record<string, FormDataEntryValue>) =>
      api("/api/setup", { method: "POST", body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: "/" });
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setup.mutate(Object.fromEntries(new FormData(event.currentTarget)));
  };

  return (
    <AuthCard
      title="Welcome to Printrio"
      subtitle="Create the administrator account for this instance."
    >
      <form onSubmit={onSubmit}>
        <FormError error={setup.error} />
        <Field label="Name" name="displayName" autoComplete="name" />
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field
          label="Password (min. 12 characters)"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
        />
        <SubmitButton pending={setup.isPending}>Create account</SubmitButton>
      </form>
    </AuthCard>
  );
}
