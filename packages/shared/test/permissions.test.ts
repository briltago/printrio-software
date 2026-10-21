import { describe, expect, it } from "vitest";
import { permissionFor } from "../src/permissions.ts";

describe("permissionFor", () => {
  it("maps change requests to permissions and leaves reads open", () => {
    expect(permissionFor("GET", "/api/orders")).toBeNull();
    expect(permissionFor("POST", "/api/orders")).toBe("orders.manage");
    expect(permissionFor("PUT", "/api/jobs/:id/order")).toBe("orders.manage");
    expect(permissionFor("POST", "/api/printers/:id/commands")).toBe("printers.control");
    expect(permissionFor("POST", "/api/printers/:id/queue/start")).toBe("queue.manage");
    expect(permissionFor("DELETE", "/api/printers/:id/files")).toBe("files.manage");
    expect(permissionFor("PUT", "/api/printers/:id/spool")).toBe("filament.manage");
    expect(permissionFor("PATCH", "/api/printers/:id")).toBe("printers.manage");
    expect(permissionFor("PUT", "/api/printers/:id/config/file")).toBe("printers.manage");
    expect(permissionFor("POST", "/api/library/send")).toBe("files.manage");
    expect(permissionFor("POST", "/api/modules/:id/*", "business")).toBe("module.business");
    expect(permissionFor("PATCH", "/api/settings")).toBeNull(); // admin-only anyway
  });
});
