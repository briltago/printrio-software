import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

describe("config", () => {
  it("builds the database URL from POSTGRES_* with any password", () => {
    const config = loadConfig({ POSTGRES_HOST: "postgres", POSTGRES_PASSWORD: "p@ss:w/rd?#%1 ž" });
    expect(config.DATABASE_URL).toBe(
      "postgres://printrio:p%40ss%3Aw%2Frd%3F%23%251%20%C5%BE@postgres:5432/printrio",
    );
    const url = new URL(config.DATABASE_URL);
    expect(decodeURIComponent(url.password)).toBe("p@ss:w/rd?#%1 ž");
    expect(url.hostname).toBe("postgres");
  });

  it("prefers DATABASE_URL and explains an invalid one", () => {
    expect(
      loadConfig({
        DATABASE_URL: "postgres://a:b@db:5432/x",
        POSTGRES_HOST: "postgres",
        POSTGRES_PASSWORD: "c",
      }).DATABASE_URL,
    ).toBe("postgres://a:b@db:5432/x");
    expect(() =>
      loadConfig({ DATABASE_URL: "postgres://printrio:a#b@postgres:5432/printrio/" + "%" }),
    ).toThrow(/percent-encoded/);
  });

  it("treats an empty SETUP_CODE as unset and refuses a short one", () => {
    const base = { DATABASE_URL: "postgres://a:b@db:5432/x" };
    expect(loadConfig({ ...base, SETUP_CODE: "" }).SETUP_CODE).toBeUndefined();
    expect(loadConfig(base).SETUP_CODE).toBeUndefined();
    expect(loadConfig({ ...base, SETUP_CODE: "K7QM-2XPA-9DWT" }).SETUP_CODE).toBe("K7QM-2XPA-9DWT");
    expect(() => loadConfig({ ...base, SETUP_CODE: "short" })).toThrow(/at least 8 characters/);
    expect(loadConfig({ ...base, BACKUP_PASSPHRASE: "" }).BACKUP_PASSPHRASE).toBeUndefined();
    expect(() => loadConfig({ ...base, BACKUP_PASSPHRASE: "short" })).toThrow(
      /at least 12 characters/,
    );
  });
});
