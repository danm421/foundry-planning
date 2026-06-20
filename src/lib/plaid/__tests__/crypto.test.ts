import { describe, expect, it, beforeEach, vi } from "vitest";

const VALID_KEY_B64 = "B".repeat(43) + "="; // 32 bytes base64 (44 chars)

beforeEach(() => {
  vi.resetModules();
  process.env.PLAID_ENCRYPTION_KEY = VALID_KEY_B64;
});

describe("plaid crypto", () => {
  it("round-trips plaintext", async () => {
    const { encrypt, decrypt } = await import("../crypto");
    const ciphertext = encrypt("access-sandbox-abc123");
    expect(ciphertext).not.toContain("access-sandbox-abc123");
    expect(decrypt(ciphertext)).toBe("access-sandbox-abc123");
  });

  it("produces different ciphertexts for the same plaintext (random IV)", async () => {
    const { encrypt } = await import("../crypto");
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
  });

  it("throws on tampered ciphertext (auth tag failure)", async () => {
    const { encrypt, decrypt } = await import("../crypto");
    const ciphertext = encrypt("payload");
    // Flip a byte in the middle of the ciphertext payload.
    const buf = Buffer.from(ciphertext, "base64");
    buf[20] ^= 0xff;
    const tampered = buf.toString("base64");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws when PLAID_ENCRYPTION_KEY is missing", async () => {
    delete process.env.PLAID_ENCRYPTION_KEY;
    const { encrypt } = await import("../crypto");
    expect(() => encrypt("anything")).toThrow(/PLAID_ENCRYPTION_KEY/);
  });

  it("throws when PLAID_ENCRYPTION_KEY is the wrong length", async () => {
    process.env.PLAID_ENCRYPTION_KEY = Buffer.from("short").toString("base64");
    const { encrypt } = await import("../crypto");
    expect(() => encrypt("anything")).toThrow(/32 bytes/);
  });
});
