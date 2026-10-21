import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url(
    "Invalid URL. Special characters in the password (@ : / ? # % …) must be percent-encoded — or set POSTGRES_PASSWORD (and POSTGRES_HOST, …) instead of DATABASE_URL.",
  ),
  /** Directory with the built web UI. Served with SPA fallback when set. */
  WEB_DIR: z.string().optional(),
  /** Set the Secure flag on cookies. Enable when served over HTTPS. */
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /**
   * Secret used to encrypt printer credentials at rest (min. 32 characters).
   * When unset, one is generated on first start and stored in DATA_DIR.
   */
  APP_SECRET: z.string().min(32).optional(),
  DATA_DIR: z.string().default("./data"),
  /** printrio-licensing base URL (leases are verified with pinned keys either way). */
  LICENSING_URL: z.url().optional(),
  /**
   * Which proxies may set X-Forwarded-For (client IP for rate limits and the
   * audit log): "false" (default, the direct peer), "true" (any — only when
   * the port is reachable solely through the proxy), a hop count such as "1",
   * or addresses/CIDRs such as "172.16.0.0/12".
   */
  TRUST_PROXY: z
    .string()
    .default("false")
    .transform((value): boolean | number | string =>
      value === "true"
        ? true
        : value === "false" || value === ""
          ? false
          : /^\d+$/.test(value)
            ? Number(value)
            : value,
    ),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /** Look for new Printrio releases on GitHub (only the version is read; nothing is sent). */
  UPDATE_CHECK: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});

export type Config = z.infer<typeof configSchema>;

/**
 * DATABASE_URL, or one built from POSTGRES_HOST / POSTGRES_PORT / POSTGRES_USER /
 * POSTGRES_PASSWORD / POSTGRES_DB with the user and password percent-encoded, so
 * a password may contain any character (Docker Compose sets these).
 */
export function databaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (!env.POSTGRES_HOST || env.POSTGRES_PASSWORD === undefined) return undefined;
  const user = encodeURIComponent(env.POSTGRES_USER || "printrio");
  const password = encodeURIComponent(env.POSTGRES_PASSWORD);
  const port = env.POSTGRES_PORT || "5432";
  const database = encodeURIComponent(env.POSTGRES_DB || "printrio");
  return `postgres://${user}:${password}@${env.POSTGRES_HOST}:${port}/${database}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse({ ...env, DATABASE_URL: databaseUrl(env) });
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return result.data;
}
