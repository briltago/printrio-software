import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
  verify,
} from "node:crypto";
import { eq } from "drizzle-orm";
import type { SecretBox } from "../crypto.ts";
import type { Database } from "../db/client.ts";
import { instanceSettings } from "../db/schema.ts";

const KEY = "instance_identity";

/**
 * The instance's Ed25519 identity (docs/ARCHITECTURE.md §7): created on first
 * start, private key encrypted with the instance secret. Licence requests are
 * signed with it; the instance ID is derived from the public key.
 */
export class InstanceIdentity {
  private constructor(
    private privateKey: KeyObject,
    /** Raw public key, base64url. */
    readonly publicKey: string,
    readonly instanceId: string,
  ) {}

  /**
   * The stored identity, or a new one. If the instance secret changed (the
   * stored key cannot be decrypted), a new identity replaces it; the licence
   * then has to be activated again (it was bound to the old key).
   */
  static async load(db: Database, secrets: SecretBox): Promise<InstanceIdentity> {
    const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.key, KEY));
    const stored = row ? decryptKey(row.value, secrets) : null;
    if (stored) return InstanceIdentity.from(stored);

    const privateKey = generateKeyPairSync("ed25519").privateKey;
    const der = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    const value = JSON.stringify({ privateKey: secrets.encrypt(der) });
    if (row) {
      await db
        .update(instanceSettings)
        .set({ value, updatedAt: new Date() })
        .where(eq(instanceSettings.key, KEY));
      return InstanceIdentity.from(privateKey);
    }
    await db.insert(instanceSettings).values({ key: KEY, value }).onConflictDoNothing();
    // Read it back: another process may have won the race.
    return InstanceIdentity.load(db, secrets);
  }

  private static from(privateKey: KeyObject) {
    const publicKey = createPublicKey(privateKey).export({ format: "jwk" }).x as string;
    return new InstanceIdentity(privateKey, publicKey, instanceIdOf(publicKey));
  }

  /** Ed25519 signature of `message`, base64url. */
  sign(message: string) {
    return sign(null, Buffer.from(message), this.privateKey).toString("base64url");
  }
}

function decryptKey(value: string, secrets: SecretBox): KeyObject | null {
  try {
    const { privateKey } = JSON.parse(value) as { privateKey: string };
    return createPrivateKey({
      key: Buffer.from(secrets.decrypt(privateKey), "base64"),
      format: "der",
      type: "pkcs8",
    });
  } catch {
    return null;
  }
}

/** First 32 hex characters of sha256(raw public key). Matches printrio-licensing. */
export function instanceIdOf(publicKey: string) {
  return createHash("sha256")
    .update(Buffer.from(publicKey, "base64url"))
    .digest("hex")
    .slice(0, 32);
}

/** Verifies an Ed25519 signature made by the raw (base64url) public key. */
export function verifyEd25519(publicKey: string, message: string | Buffer, signature: string) {
  if (!publicKey) return false;
  try {
    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: publicKey },
      format: "jwk",
    });
    return verify(
      null,
      typeof message === "string" ? Buffer.from(message) : message,
      key,
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

/** Payload of a compact EdDSA JWS signed by `publicKey`, or null. */
export function verifyJws(token: string, publicKey: string): unknown | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];
  if (!verifyEd25519(publicKey, `${header}.${body}`, signature)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
