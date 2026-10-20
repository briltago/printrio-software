import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LibraryListingDto } from "@printrio/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, sessionCookie } from "./helpers.ts";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;

const api = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
  ctx.app.inject({ method, url, payload, headers: { cookie: admin } });

const uploadTo = (orderId: string, name: string, content = "G28\nG1 X10\n") => {
  const boundary = "----printrio";
  return ctx.app.inject({
    method: "POST",
    url: `/api/orders/${orderId}/files`,
    headers: { cookie: admin, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n${content}\r\n--${boundary}--\r\n`,
  });
};

const createOrder = async (body: object) => {
  const res = await api("POST", "/api/orders", body);
  expect(res.statusCode).toBe(201);
  const id = res.json().id as string;
  return (await api("GET", `/api/orders/${id}`)).json();
};

beforeAll(async () => {
  ctx = await createTestApp();
  const setup = await ctx.app.inject({
    method: "POST",
    url: "/api/setup",
    payload: {
      email: "admin@example.com",
      displayName: "Admin",
      password: "correct horse battery",
    },
  });
  admin = sessionCookie(setup.headers["set-cookie"]);
});

afterAll(async () => {
  await ctx.close();
});

describe("order folders", () => {
  it("creates a folder from the default template and keeps names unique", async () => {
    const first = await createOrder({ name: "Gears" });
    expect(first.folder).toBe("Orders/Gears");
    expect(existsSync(join(ctx.dataDir, "files", "Orders", "Gears"))).toBe(true);
    const second = await createOrder({ name: "Gears" });
    expect(second.folder).toBe("Orders/Gears (2)");
  });

  it("uses the workspace template with customer and date placeholders", async () => {
    const res = await api("PATCH", "/api/settings", {
      orderFolders: { enabled: true, template: "/Commercial/{customer}/{year}/{order}/" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().orderFolders.template).toBe("Commercial/{customer}/{year}/{order}");
    const order = await createOrder({ name: "Brackets: v2", customer: "Acme / Labs" });
    expect(order.folder).toBe(`Commercial/Acme Labs/${new Date().getFullYear()}/Brackets v2`);
    const noCustomer = await createOrder({ name: "Spare parts" });
    expect(noCustomer.folder).toMatch(/^Commercial\/No customer\/\d{4}\/Spare parts$/);
  });

  it("rejects invalid templates", async () => {
    for (const template of ["", "Orders/../{order}", "Orders/{client}", "Orders/{order"]) {
      const res = await api("PATCH", "/api/settings", {
        orderFolders: { enabled: true, template },
      });
      expect(res.statusCode, template).toBe(400);
    }
  });

  it("lets an order choose its own folder, and can be switched off", async () => {
    const own = await createOrder({ name: "Gift", folder: "Personal/{order}" });
    expect(own.folder).toBe("Personal/Gift");
    await api("PATCH", "/api/settings", {
      orderFolders: { enabled: false, template: "Orders/{order}" },
    });
    const none = await createOrder({ name: "No folder" });
    expect(none.folder).toBeNull();
    // Uploading still works: the folder is created on demand.
    expect((await uploadTo(none.id, "part.gcode")).statusCode).toBe(201);
    const after = (await api("GET", `/api/orders/${none.id}`)).json();
    expect(after.folder).toBe("Orders/No folder");
    expect(after.files.map((f: { name: string }) => f.name)).toEqual(["part.gcode"]);
  });

  it("stores uploads in the order folder and lists them on the order", async () => {
    await api("PATCH", "/api/settings", {
      orderFolders: { enabled: true, template: "Orders/{order}" },
    });
    const order = await createOrder({ name: "Drone frame", customer: "Novák" });
    expect(
      (
        await uploadTo(
          order.id,
          "arm.gcode",
          "; estimated printing time (normal mode) = 1h 2m\nG28\n",
        )
      ).statusCode,
    ).toBe(201);
    expect((await uploadTo(order.id, "notes.txt")).statusCode).toBe(400);
    const detail = (await api("GET", `/api/orders/${order.id}`)).json();
    expect(detail.files).toMatchObject([
      { name: "arm.gcode", path: "Orders/Drone frame/arm.gcode", estimatedSeconds: 3720 },
    ]);
    const listing: LibraryListingDto = (
      await api("GET", `/api/library?dir=${encodeURIComponent("Orders/Drone frame")}`)
    ).json();
    expect(listing.files.map((f) => f.name)).toEqual(["arm.gcode"]);

    // Renaming the order keeps its folder (files never move behind the user's back).
    await api("PATCH", `/api/orders/${order.id}`, { name: "Drone frame XL" });
    expect((await api("GET", `/api/orders/${order.id}`)).json().folder).toBe("Orders/Drone frame");

    // Deleting the order keeps the files.
    expect((await api("DELETE", `/api/orders/${order.id}`)).statusCode).toBe(204);
    expect(existsSync(join(ctx.dataDir, "files", "Orders", "Drone frame", "arm.gcode"))).toBe(true);
  });

  it("suggests customer names already used on orders", async () => {
    const { customers } = (await api("GET", "/api/orders/customers")).json();
    // Only names of existing orders ("Novák" was deleted above).
    expect(customers).toEqual(["Acme / Labs"]);
  });
});
