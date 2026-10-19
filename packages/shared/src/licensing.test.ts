import { describe, expect, it } from "vitest";
import { effectiveLimits, FREE_LIMITS, type Lease } from "./licensing.ts";

const lease: Lease = {
  licenceId: "lic_1",
  instanceId: "inst_1",
  tier: "pro",
  limits: { printers: 8, users: 10 },
  features: ["fleet-queue"],
  modules: [{ id: "pro", version: "1.0.0" }],
  issuedAt: "2026-10-19T00:00:00.000Z",
  expiresAt: "2026-10-22T00:00:00.000Z",
};

describe("effectiveLimits", () => {
  it("falls back to Free without a lease", () => {
    expect(effectiveLimits(null)).toEqual(FREE_LIMITS);
  });

  it("uses lease limits while the lease is valid", () => {
    expect(effectiveLimits(lease, new Date("2026-10-21T23:59:59Z"))).toEqual({
      printers: 8,
      users: 10,
    });
  });

  it("falls back to Free once the grace period has passed", () => {
    expect(effectiveLimits(lease, new Date("2026-10-22T00:00:00Z"))).toEqual(FREE_LIMITS);
  });
});
