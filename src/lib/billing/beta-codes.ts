import { createHash, randomInt } from "node:crypto";

// Crockford base32 — no I, L, O, U (avoids visual ambiguity).
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GROUPS = 2;
const GROUP_LEN = 4;

/** A fresh single-use code, e.g. "FNDR-7K2P-9QX4". */
export function generateCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let s = "";
    for (let i = 0; i < GROUP_LEN; i++) s += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(s);
  }
  return `FNDR-${groups.join("-")}`;
}

/**
 * Canonicalize user-entered text before hashing: uppercase, drop separators
 * and the FNDR prefix, and fold the chars a human is likely to mistype
 * (O->0, I/L->1) onto their Crockford equivalents.
 */
export function normalizeCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/[^0-9A-Z]/g, "")
    .replace(/^FNDR/, "");
}

/** sha256 hex of the normalized code body. Stored in `beta_codes.code_hash`. */
export function hashCode(input: string): string {
  return createHash("sha256").update(normalizeCode(input)).digest("hex");
}
