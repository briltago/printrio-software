import { describe, expect, it } from "vitest";
import { periodStart } from "./jobs.ts";

describe("periodStart", () => {
  const now = new Date(2026, 9, 20, 15, 30);
  it("starts months, years and rolling windows", () => {
    expect(periodStart("month", now)).toEqual(new Date(2026, 9, 1));
    expect(periodStart("year", now)).toEqual(new Date(2026, 0, 1));
    expect(periodStart("30d", now)?.getTime()).toBe(now.getTime() - 30 * 86_400_000);
    expect(periodStart("all", now)).toBeUndefined();
  });
});
