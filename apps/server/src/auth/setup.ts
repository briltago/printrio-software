import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { BlockList, isIP } from "node:net";

/**
 * Addresses a first-run setup is expected from: the machine itself, private
 * networks, link-local, and carrier-grade NAT (Tailscale). Anything else is
 * the public internet, where a stranger could reach a new instance first.
 */
const local = new BlockList();
local.addSubnet("127.0.0.0", 8);
local.addSubnet("10.0.0.0", 8);
local.addSubnet("172.16.0.0", 12);
local.addSubnet("192.168.0.0", 16);
local.addSubnet("169.254.0.0", 16);
local.addSubnet("100.64.0.0", 10);
local.addAddress("::1", "ipv6");
local.addSubnet("fc00::", 7, "ipv6");
local.addSubnet("fe80::", 10, "ipv6");

export function isLocalAddress(ip: string | undefined): boolean {
  if (!ip) return false;
  // IPv4 clients on a dual-stack socket: ::ffff:192.168.1.5
  const address = ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
  const version = isIP(address);
  if (version === 0) return false;
  return local.check(address, version === 6 ? "ipv6" : "ipv4");
}

/** A code for the first-run setup, easy to copy from a log line: XXXX-XXXX-XXXX. */
export function newSetupCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const chars = [...randomBytes(12)].map((byte) => alphabet[byte % alphabet.length]).join("");
  return chars.match(/.{4}/g)?.join("-") ?? chars;
}

/** Compares codes in constant time, ignoring case, spaces and dashes. */
export function sameSetupCode(given: unknown, expected: string) {
  if (typeof given !== "string") return false;
  const digest = (value: string) =>
    createHash("sha256").update(value.replace(/[\s-]/g, "").toUpperCase()).digest();
  return timingSafeEqual(digest(given), digest(expected));
}
