import { NAV_ITEM_IDS } from "@printrio/shared";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { NAV_ROUTES } from "./nav.ts";
import { createAppRouter } from "./router.tsx";

describe("router", () => {
  it("builds the route tree without duplicate routes", () => {
    // TanStack Router throws an invariant when two routes share an id (e.g. a
    // section that has a page but is still listed as a placeholder).
    const router = createAppRouter(new QueryClient());
    for (const id of NAV_ITEM_IDS) {
      expect(Object.keys(router.routesByPath)).toContain(NAV_ROUTES[id]);
    }
  });
});
