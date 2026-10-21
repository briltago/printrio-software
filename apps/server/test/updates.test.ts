import { describe, expect, it } from "vitest";
import { compareVersions, parseVersion, UpdateChecker } from "../src/updates.ts";

const releases = [
  {
    tag_name: "v1.3.0-beta.1",
    html_url: "https://github.com/x/releases/v1.3.0-beta.1",
    published_at: "2026-11-02T00:00:00Z",
    draft: false,
    prerelease: true,
  },
  {
    tag_name: "v1.2.0",
    html_url: "https://github.com/x/releases/v1.2.0",
    published_at: "2026-11-01T00:00:00Z",
    draft: false,
    prerelease: false,
  },
  {
    tag_name: "v2.0.0",
    html_url: "https://github.com/x/releases/v2.0.0",
    published_at: null,
    draft: true,
    prerelease: false,
  },
  {
    tag_name: "v1.1.0",
    html_url: "https://github.com/x/releases/v1.1.0",
    published_at: "2026-10-01T00:00:00Z",
    draft: false,
    prerelease: false,
  },
];

function fakeFetch(counter: { calls: number }, body: unknown = releases, ok = true) {
  return (async () => {
    counter.calls++;
    return new Response(JSON.stringify(body), { status: ok ? 200 : 404 });
  }) as unknown as typeof fetch;
}

describe("update check", () => {
  it("compares versions", () => {
    const v = (text: string) => parseVersion(text) as NonNullable<ReturnType<typeof parseVersion>>;
    expect(compareVersions(v("1.2.0"), v("1.1.9"))).toBeGreaterThan(0);
    expect(compareVersions(v("1.10.0"), v("1.9.0"))).toBeGreaterThan(0);
    expect(compareVersions(v("1.2.0"), v("1.2.0-beta.2"))).toBeGreaterThan(0);
    expect(compareVersions(v("1.2.0-beta.10"), v("1.2.0-beta.2"))).toBeGreaterThan(0);
    expect(parseVersion("edge-abc")).toBeNull();
    expect(parseVersion("dev")).toBeNull();
  });

  it("finds the newest stable release, cached for six hours", async () => {
    const counter = { calls: 0 };
    let now = 0;
    const checker = new UpdateChecker({
      version: "1.1.0",
      enabled: true,
      fetch: fakeFetch(counter),
      now: () => now,
    });
    const info = await checker.info();
    expect(info).toMatchObject({
      current: "1.1.0",
      updateAvailable: true,
      latest: { version: "1.2.0" },
      checking: true,
    });
    await checker.info();
    expect(counter.calls).toBe(1);
    now += 7 * 3_600_000;
    await checker.info();
    expect(counter.calls).toBe(2);
  });

  it("offers pre-releases only to pre-release instances, and stays quiet when off", async () => {
    const beta = await new UpdateChecker({
      version: "1.2.0-beta.1",
      enabled: true,
      fetch: fakeFetch({ calls: 0 }),
    }).info();
    expect(beta.latest?.version).toBe("1.3.0-beta.1");
    const current = await new UpdateChecker({
      version: "1.2.0",
      enabled: true,
      fetch: fakeFetch({ calls: 0 }),
    }).info();
    expect(current.updateAvailable).toBe(false);
    const counter = { calls: 0 };
    const off = await new UpdateChecker({
      version: "1.0.0",
      enabled: false,
      fetch: fakeFetch(counter),
    }).info();
    expect(off).toMatchObject({ checking: false, updateAvailable: false });
    const dev = await new UpdateChecker({
      version: "dev",
      enabled: true,
      fetch: fakeFetch(counter),
    }).info();
    expect(dev.checking).toBe(false);
    expect(counter.calls).toBe(0);
    const unreachable = await new UpdateChecker({
      version: "1.0.0",
      enabled: true,
      fetch: fakeFetch({ calls: 0 }, {}, false),
    }).info();
    expect(unreachable).toMatchObject({ latest: null, updateAvailable: false });
  });
});
