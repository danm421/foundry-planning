// src/lib/crypto/secrets.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret } from "./secrets";

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("secrets", () => {
  it("round-trips a value", () => {
    const out = decryptSecret(encryptSecret("orion-access-token"));
    expect(out).toBe("orion-access-token");
  });

  it("produces the v1 envelope with distinct ivs", () => {
    const a = encryptSecret("x");
    const b = encryptSecret("x");
    expect(a.startsWith("v1:")).toBe(true);
    expect(a).not.toBe(b); // random IV per call
  });

  it("rejects a tampered ciphertext", () => {
    const blob = encryptSecret("secret");
    const parts = blob.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("throws when the key is missing", () => {
    const saved = process.env.CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    try {
      expect(() => encryptSecret("x")).toThrow(/CREDENTIAL_ENCRYPTION_KEY/);
    } finally {
      process.env.CREDENTIAL_ENCRYPTION_KEY = saved;
    }
  });

  it("rejects a tampered auth tag", () => {
    const blob = encryptSecret("secret");
    const parts = blob.split(":");
    parts[2] = Buffer.from("0000000000000000").toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });
});
