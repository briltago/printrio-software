import type { SetupStatus, User } from "@printrio/shared";
import { queryOptions } from "@tanstack/react-query";
import { ApiError, api } from "./api.ts";

export const setupStatusQuery = queryOptions({
  queryKey: ["setup-status"],
  staleTime: 30_000,
  queryFn: () => api<SetupStatus>("/api/setup/status"),
});

export const meQuery = queryOptions({
  queryKey: ["me"],
  staleTime: 30_000,
  queryFn: async () => {
    try {
      return await api<User>("/api/auth/me");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
});
