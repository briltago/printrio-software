import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { Brand } from "./components.tsx";
import { api } from "./lib/api.ts";
import { meQuery } from "./lib/session.ts";

interface NavItem {
  label: string;
  icon: string;
  to?: "/";
}

// Mirrors the workspace navigation shown on printrio.app; items without a route arrive in later phases.
const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Workspace",
    items: [
      { label: "Overview", icon: "⌂", to: "/" },
      { label: "Printers", icon: "▦" },
      { label: "Print jobs", icon: "◷" },
      { label: "G-code library", icon: "▤" },
    ],
  },
  {
    section: "Inventory & costs",
    items: [
      { label: "Filament", icon: "◉" },
      { label: "Costs", icon: "⌁" },
    ],
  },
  { section: "System", items: [{ label: "Settings", icon: "⚙" }] },
];

export function AppLayout() {
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
  const initials = (user?.displayName ?? "?")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="grid min-h-screen md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="min-w-0 border-line border-b bg-sidebar px-4 py-5 md:border-r md:border-b-0">
        <div className="px-2">
          <Brand size={26} />
        </div>
        <nav aria-label="Main navigation" className="mt-7 flex gap-6 overflow-x-auto md:block">
          {NAV.map((group) => (
            <div key={group.section} className="md:mb-6">
              <p className="mb-2 hidden px-2 text-[10px] font-semibold tracking-[0.12em] text-subtle uppercase md:block">
                {group.section}
              </p>
              <ul className="flex gap-1 md:block md:space-y-1">
                {group.items.map((item) => (
                  <li key={item.label}>
                    {item.to ? (
                      <Link
                        to={item.to}
                        className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-sm whitespace-nowrap text-muted hover:text-text"
                        activeProps={{ className: "!border-accent/20 bg-accent/10 !text-text" }}
                      >
                        <span aria-hidden="true">{item.icon}</span>
                        {item.label}
                      </Link>
                    ) : (
                      <span
                        className="flex items-center gap-3 px-3 py-2 text-sm whitespace-nowrap text-subtle"
                        title="Coming soon"
                      >
                        <span aria-hidden="true">{item.icon}</span>
                        {item.label}
                        <span className="ml-auto rounded-full border border-line px-1.5 text-[9px] tracking-wide uppercase">
                          Soon
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="flex items-center justify-end gap-3 border-line border-b px-6 py-3">
          <span className="text-sm text-muted">{user?.displayName}</span>
          <span
            aria-hidden="true"
            className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-[11px] font-bold text-accent-ink"
          >
            {initials}
          </span>
          <button
            type="button"
            onClick={() => logout.mutate()}
            className="btn btn-secondary py-1.5"
          >
            Sign out
          </button>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
