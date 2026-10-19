import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Encrypts small secrets (printer API keys) at rest with AES-256-GCM. */
export class SecretBox {
  private key: Buffer;

  constructor(secret: string) {
    this.key = createHash("sha256").update(secret).digest();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return ["v1", iv, cipher.getAuthTag(), data]
      .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
      .join(".");
  }

  decrypt(payload: string): string {
    const [version, iv, tag, data] = payload.split(".");
    if (version !== "v1" || !iv || !tag || !data) throw new Error("Unsupported secret format.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}

/** APP_SECRET if configured, otherwise a generated secret persisted in DATA_DIR. */
export async function resolveAppSecret(
  appSecret: string | undefined,
  dataDir: string,
): Promise<string> {
  if (appSecret) return appSecret;
  const file = join(dataDir, "app-secret");
  if (existsSync(file)) return (await readFile(file, "utf8")).trim();
  await mkdir(dataDir, { recursive: true });
  const secret = randomBytes(32).toString("base64url");
  await writeFile(file, `${secret}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  return secret;
}
