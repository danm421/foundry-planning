import { describe, expect, it } from "vitest";
import { sha256Hex } from "../file-hash";

describe("sha256Hex", () => {
  it("hashes a Buffer deterministically (RFC 6234 vector)", async () => {
    const buf = Buffer.from("hello world", "utf8");
    const hash = await sha256Hex(buf);
    expect(hash).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });

  it("handles a Uint8Array", async () => {
    const arr = new TextEncoder().encode("hello world");
    expect(await sha256Hex(arr)).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });

  it("handles an ArrayBuffer", async () => {
    const arr = new TextEncoder().encode("hello world");
    expect(
      await sha256Hex(
        arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength),
      ),
    ).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });

  it("returns 64-hex characters", async () => {
    const hash = await sha256Hex(Buffer.from("anything"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
