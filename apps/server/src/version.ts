declare const __PRINTRIO_VERSION__: string | undefined;

/** Printrio release (e.g. "1.2.0"); "dev" when running from source. Baked in at build time. */
export const VERSION: string =
  typeof __PRINTRIO_VERSION__ === "string" && __PRINTRIO_VERSION__
    ? __PRINTRIO_VERSION__
    : (process.env.PRINTRIO_VERSION ?? "dev");

const REPOSITORY = "https://github.com/briltago/printrio-software";

/**
 * Where users can get the source code of the running version (AGPL section 13).
 * Modified versions must set PRINTRIO_SOURCE_URL to their own source.
 */
export function sourceUrl(version = VERSION, override = process.env.PRINTRIO_SOURCE_URL) {
  if (override) return override;
  if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) return `${REPOSITORY}/tree/v${version}`;
  const edge = /^edge-([0-9a-f]{7,40})$/.exec(version);
  if (edge) return `${REPOSITORY}/commit/${edge[1]}`;
  return REPOSITORY;
}
