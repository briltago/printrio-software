declare const __PRINTRIO_VERSION__: string | undefined;

/** Printrio release (e.g. "1.2.0"); "dev" when running from source. Baked in at build time. */
export const VERSION: string =
  typeof __PRINTRIO_VERSION__ === "string" && __PRINTRIO_VERSION__
    ? __PRINTRIO_VERSION__
    : (process.env.PRINTRIO_VERSION ?? "dev");
