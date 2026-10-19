import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "../lib/api.ts";
import { meQuery } from "../lib/session.ts";

export function DashboardPage() {
  const { data: user } = useSuspenseQuery(meQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: () => api("/api/auth/logout", { method: "POST" }),
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: "/login" });
    },
  });

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <img src="/icon.png" alt="" className="h-7 w-7" />
          <span className="font-semibold">Printrio</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted">{user?.displayName}</span>
          <button
            type="button"
            onClick={() => logout.mutate()}
            className="text-accent hover:underline"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="text-2xl font-semibold">Printers</h1>
        <div className="mt-6 rounded-2xl border border-dashed border-border p-10 text-center text-muted">
          No printers yet. Printer connections arrive with the Moonraker driver.
        </div>
      </main>
    </div>
  );
}
