import type { UpdateInfoDto } from "@printrio/shared";

/**
 * Newest Printrio release from GitHub Releases, cached for six hours. Only a
 * GET to the public API: nothing about the instance is sent.
 */

const RELEASES = "https://api.github.com/repos/briltago/printrio-software/releases?per_page=10";
const CACHE_MS = 6 * 3_600_000;

type Semver = [number, number, number, string | null];

export function parseVersion(text: string): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?$/.exec(text.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? null];
}

/** > 0 when a is newer than b. A release outranks its pre-releases. */
export function compareVersions(a: Semver, b: Semver) {
  for (let index = 0; index < 3; index++) {
    const diff = (a[index] as number) - (b[index] as number);
    if (diff) return diff;
  }
  if (a[3] === b[3]) return 0;
  if (a[3] === null) return 1;
  if (b[3] === null) return -1;
  return a[3].localeCompare(b[3], undefined, { numeric: true });
}

interface Release {
  tag_name: string;
  html_url: string;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
}

export class UpdateChecker {
  private cache: { at: number; latest: UpdateInfoDto["latest"] } | null = null;

  constructor(
    private readonly options: {
      version: string;
      enabled: boolean;
      fetch?: typeof fetch;
      now?: () => number;
    },
  ) {}

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  async info(): Promise<UpdateInfoDto> {
    const current = parseVersion(this.options.version);
    const checking = this.options.enabled && current !== null;
    if (!checking)
      return {
        current: this.options.version,
        latest: null,
        updateAvailable: false,
        checking,
        checkedAt: null,
      };
    if (!this.cache || this.now() - this.cache.at > CACHE_MS) {
      const latest = await this.fetchLatest(current[3] !== null).catch(
        () => this.cache?.latest ?? null,
      );
      this.cache = { at: this.now(), latest };
    }
    const latest = this.cache.latest;
    const parsed = latest ? parseVersion(latest.version) : null;
    return {
      current: this.options.version,
      latest,
      updateAvailable: parsed !== null && compareVersions(parsed, current) > 0,
      checking,
      checkedAt: new Date(this.cache.at).toISOString(),
    };
  }

  /** Newest release; pre-releases count only for instances already on one. */
  private async fetchLatest(includePrereleases: boolean): Promise<UpdateInfoDto["latest"]> {
    const response = await (this.options.fetch ?? fetch)(RELEASES, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Printrio" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const releases = (await response.json()) as Release[];
    let best: { release: Release; version: Semver } | null = null;
    for (const release of releases) {
      if (release.draft || (release.prerelease && !includePrereleases)) continue;
      const version = parseVersion(release.tag_name);
      if (version && (!best || compareVersions(version, best.version) > 0))
        best = { release, version };
    }
    return best
      ? {
          version: best.release.tag_name.replace(/^v/, ""),
          url: best.release.html_url,
          publishedAt: best.release.published_at,
        }
      : null;
  }
}
