// src/lib/crypto/secrets.ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) throw new Error("CREDENTIAL_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes (base64)");
  }
  return buf;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(blob: string): string {
  const [version, ivB64, tagB64, ctB64] = blob.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("Unrecognized secret envelope");
  }
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
