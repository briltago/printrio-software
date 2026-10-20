import { NAV_ITEM_IDS } from "@printrio/shared";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { z } from "zod";
import { AppLayout } from "./layout.tsx";
import { printersQuery, settingsQuery } from "./lib/queries.ts";
import { meQuery, setupStatusQuery } from "./lib/session.ts";
import { LIVE_SECTIONS, NAV_ROUTES } from "./nav.ts";
import { CostsPage } from "./pages/costs.tsx";
import { FilamentPage } from "./pages/filament.tsx";
import { FleetPage } from "./pages/fleet.tsx";
import { JobsPage } from "./pages/jobs.tsx";
import { LibraryPage } from "./pages/library.tsx";
import { LoginPage } from "./pages/login.tsx";
import { MAINTENANCE_TABS, MaintenancePage } from "./pages/maintenance.tsx";
import { ModulePage } from "./pages/module.tsx";
import { OnboardingPage } from "./pages/onboarding.tsx";
import { OrdersPage } from "./pages/orders.tsx";
import { PlaceholderPage } from "./pages/placeholder.tsx";
import { PrinterPage } from "./pages/printer.tsx";
import { SettingsPage } from "./pages/settings.tsx";
import { SetupPage } from "./pages/setup.tsx";

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Outlet,
});

async function requireSession(queryClient: QueryClient) {
  // fetchQuery (not ensureQueryData) so data invalidated after setup/login/logout is refetched.
  const { setupRequired } = await queryClient.fetchQuery(setupStatusQuery);
  if (setupRequired) throw redirect({ to: "/setup" });
  const me = await queryClient.fetchQuery(meQuery);
  if (!me) throw redirect({ to: "/login" });
  return me;
}

// Authenticated area: everything below renders inside the sidebar layout.
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context }) => {
    const me = await requireSession(context.queryClient);
    const settings = await context.queryClient.fetchQuery(settingsQuery);
    if (!settings.onboardingCompleted && me.role === "admin") throw redirect({ to: "/onboarding" });
  },
  component: AppLayout,
});

/** "/" opens the configured start page: one printer → its page, several → the fleet. */
const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  beforeLoad: async ({ context }) => {
    const [{ printers }, settings] = await Promise.all([
      context.queryClient.fetchQuery(printersQuery),
      context.queryClient.fetchQuery(settingsQuery),
    ]);
    const first = printers[0];
    const openPrinter =
      settings.defaultView === "printer" ||
      (settings.defaultView === "auto" && printers.length === 1);
    if (openPrinter && first)
      throw redirect({ to: "/printers/$printerId", params: { printerId: first.id } });
    throw redirect({ to: "/printers" });
  },
});

const fleetRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/printers",
  loader: ({ context }) => context.queryClient.ensureQueryData(printersQuery),
  component: FleetPage,
});

const printerRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/printers/$printerId",
  loader: ({ context }) => context.queryClient.ensureQueryData(printersQuery),
  component: PrinterPage,
});

const maintenanceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/printers/$printerId/maintenance",
  validateSearch: z.object({ tab: z.enum(MAINTENANCE_TABS).optional() }),
  loader: ({ context }) => context.queryClient.ensureQueryData(printersQuery),
  component: MaintenancePage,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  // Built-in tabs, or "<module>:<tab>" for tabs added by modules.
  validateSearch: z.object({ tab: z.string().optional() }),
  component: SettingsPage,
});

const filamentRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/filament",
  component: FilamentPage,
});

const jobsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/jobs",
  component: JobsPage,
});
const filesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/files",
  component: LibraryPage,
});
const ordersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/orders",
  component: OrdersPage,
});
const costsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/costs",
  component: CostsPage,
});

/** Pages added by modules (Pro, Business). */
const moduleRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/m/$moduleId/$",
  component: ModulePage,
});

/** Sections with their own route above; the rest render a placeholder until they ship. */
const placeholderRoutes = NAV_ITEM_IDS.filter((id) => !LIVE_SECTIONS.has(id)).map((id) =>
  createRoute({
    getParentRoute: () => appRoute,
    path: NAV_ROUTES[id],
    component: () => <PlaceholderPage section={id} />,
  }),
);

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding",
  beforeLoad: async ({ context }) => {
    const me = await requireSession(context.queryClient);
    if (me.role !== "admin") throw redirect({ to: "/" });
  },
  component: OnboardingPage,
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
      appRoute.addChildren([
        homeRoute,
        fleetRoute,
        printerRoute,
        maintenanceRoute,
        filamentRoute,
        jobsRoute,
        costsRoute,
        ordersRoute,
        filesRoute,
        settingsRoute,
        moduleRoute,
        ...placeholderRoutes,
      ]),
      onboardingRoute,
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
