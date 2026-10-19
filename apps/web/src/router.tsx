import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { AppLayout } from "./layout.tsx";
import { meQuery, setupStatusQuery } from "./lib/session.ts";
import { DashboardPage } from "./pages/dashboard.tsx";
import { LoginPage } from "./pages/login.tsx";
import { SetupPage } from "./pages/setup.tsx";

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Outlet,
});

// Authenticated area: everything below renders inside the sidebar layout.
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context }) => {
    // fetchQuery (not ensureQueryData) so data invalidated after setup/login/logout is refetched.
    const { setupRequired } = await context.queryClient.fetchQuery(setupStatusQuery);
    if (setupRequired) throw redirect({ to: "/setup" });
    if (!(await context.queryClient.fetchQuery(meQuery))) throw redirect({ to: "/login" });
  },
  component: AppLayout,
});

const dashboardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: DashboardPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  beforeLoad: async ({ context }) => {
    const { setupRequired } = await context.queryClient.fetchQuery(setupStatusQuery);
    if (!setupRequired) throw redirect({ to: "/login" });
  },
  component: SetupPage,
});

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree: rootRoute.addChildren([
      appRoute.addChildren([dashboardRoute]),
      loginRoute,
      setupRoute,
    ]),
    context: { queryClient },
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
