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

  it("asks for the module's permission to read Pro and Business data too", () => {
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]) {
      expect(permissionFor(method, "/api/modules/:id/*", "business")).toBe("module.business");
      expect(permissionFor(method, "/api/modules/:id/*", "pro")).toBe("module.pro");
    }
    // Other modules, the module list and the web bundles (the UI itself) carry no permission.
    expect(permissionFor("GET", "/api/modules/:id/*", "other")).toBeNull();
    expect(permissionFor("GET", "/api/modules/:id/*", "..%2Fbusiness")).toBeNull();
    expect(permissionFor("GET", "/api/modules")).toBeNull();
    expect(permissionFor("GET", "/api/modules/:id/web.js", "business")).toBeNull();
  });
});
