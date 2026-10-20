/**
 * Public keys pinned in the core (docs/ARCHITECTURE.md §7). Generated with
 * `npm run keys` in printrio-licensing; the private keys never leave the
 * licensing service (lease key) or the release machine (module key).
 *
 * Raw Ed25519 public keys, base64url. Empty until the keys are generated:
 * the core then accepts no lease and loads no module (everything stays Free).
 */
export const LEASE_PUBLIC_KEY = "";
export const MODULE_PUBLIC_KEY = "";

export const LICENSING_URL = "https://licensing.printrio.app";
