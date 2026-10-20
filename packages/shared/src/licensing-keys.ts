/**
 * Public keys pinned in the core (docs/ARCHITECTURE.md §7). Generated with
 * `npm run keys` in printrio-licensing; the private keys never leave the
 * licensing service (lease key) or the release machine (module key).
 *
 * Raw Ed25519 public keys, base64url. Builds that blank them accept no lease
 * and load no module (everything stays Free).
 */
export const LEASE_PUBLIC_KEY = "MetEfZrWc8JQaJ9ADxaKIIh83K7QWZ9N52pRPl6iRaU";
export const MODULE_PUBLIC_KEY = "1jltNrOiu9hlc8uiLU0uNgmmCz6fsZjLbfBBMWfHPDw";

export const LICENSING_URL = "https://licensing.printrio.app";
