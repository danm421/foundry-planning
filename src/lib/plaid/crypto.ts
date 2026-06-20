import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

let _key: Buffer | null = null;

function getPlaidEncryptionKey(): Buffer {
  if (_key) return _key;
  const b64 = process.env.PLAID_ENCRYPTION_KEY;
  if (!b64) {
    throw new Error("PLAID_ENCRYPTION_KEY env var is required");
  }
  const buf = Buffer.from(b64, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `PLAID_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length})`,
    );
  }
  _key = buf;
  return buf;
}

/**
 * Encrypts `plaintext` with AES-256-GCM. Returns base64(iv || ciphertext || tag).
 * Random 12-byte IV per call; ciphertexts for the same plaintext differ.
 */
export function encrypt(plaintext: string): string {
  const key = getPlaidEncryptionKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString("base64");
}

/**
 * Reverses `encrypt`. Throws on auth-tag verification failure.
 */
export function decrypt(blob: string): string {
  const key = getPlaidEncryptionKey();
  const buf = Buffer.from(blob, "base64");
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error("ciphertext too short");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
