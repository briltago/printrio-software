import type {
  Printer,
  PrinterGroup,
  UsersResponse,
  WorkspaceSettings,
  WorkspaceSettingsUpdate,
} from "@printrio/shared";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

export const printersQuery = queryOptions({
  queryKey: ["printers"],
  queryFn: () => api<{ printers: Printer[]; limit: number | null }>("/api/printers"),
  staleTime: 30_000,
});

export const groupsQuery = queryOptions({
  queryKey: ["printer-groups"],
  queryFn: () => api<{ groups: PrinterGroup[] }>("/api/printer-groups"),
  staleTime: 30_000,
});

export const settingsQuery = queryOptions({
  queryKey: ["settings"],
  queryFn: () => api<WorkspaceSettings>("/api/settings"),
  staleTime: 30_000,
});

export const usersQuery = queryOptions({
  queryKey: ["users"],
  queryFn: () => api<UsersResponse>("/api/users"),
});

/** Optimistic: the UI reflects the change immediately and rolls back if the server rejects it. */
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: WorkspaceSettingsUpdate) =>
      api<WorkspaceSettings>("/api/settings", { method: "PATCH", body: update }),
    onMutate: (update) => {
      const previous = queryClient.getQueryData(settingsQuery.queryKey);
      if (previous) queryClient.setQueryData(settingsQuery.queryKey, { ...previous, ...update });
      void queryClient.cancelQueries({ queryKey: settingsQuery.queryKey });
      return { previous };
    },
    onError: (_error, _update, context) => {
      if (context?.previous) queryClient.setQueryData(settingsQuery.queryKey, context.previous);
    },
    onSuccess: (settings) => queryClient.setQueryData(settingsQuery.queryKey, settings),
  });
}
