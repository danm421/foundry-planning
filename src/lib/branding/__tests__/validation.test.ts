import { describe, it, expect } from "vitest";
import {
  validateLogo,
  validateFavicon,
  validatePrimaryColor,
} from "../validation";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP_HEADER = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP"),
]);
const GARBAGE = Buffer.from("not an image, just text");

function pad(header: Buffer, totalBytes: number): Buffer {
  if (header.length >= totalBytes) return header;
  return Buffer.concat([header, Buffer.alloc(totalBytes - header.length)]);
}

describe("validateLogo", () => {
  it("accepts a PNG under 2 MB", () => {
    expect(validateLogo({ mime: "image/png", bytes: pad(PNG_HEADER, 1024) })).toEqual({ ok: true });
  });

  it("accepts a JPEG under 2 MB", () => {
    expect(validateLogo({ mime: "image/jpeg", bytes: pad(JPEG_HEADER, 1024) })).toEqual({ ok: true });
  });

  it("accepts a WebP under 2 MB", () => {
    expect(validateLogo({ mime: "image/webp", bytes: pad(WEBP_HEADER, 1024) })).toEqual({ ok: true });
  });

  it("rejects SVG (deferred to follow-up)", () => {
    const result = validateLogo({ mime: "image/svg+xml", bytes: Buffer.from("<svg/>") });
    expect(result.ok).toBe(false);
  });

  it("rejects PNG with JPEG MIME (magic-byte mismatch)", () => {
    const result = validateLogo({ mime: "image/jpeg", bytes: pad(PNG_HEADER, 1024) });
    expect(result.ok).toBe(false);
  });

  it("rejects > 2 MB", () => {
    const big = Buffer.concat([PNG_HEADER, Buffer.alloc(2 * 1024 * 1024 + 1)]);
    const result = validateLogo({ mime: "image/png", bytes: big });
    expect(result.ok).toBe(false);
  });

  it("rejects garbage bytes", () => {
    expect(validateLogo({ mime: "image/png", bytes: GARBAGE }).ok).toBe(false);
  });
});

describe("validateFavicon", () => {
  it("accepts a PNG under 256 KB", () => {
    expect(validateFavicon({ mime: "image/png", bytes: pad(PNG_HEADER, 1024) })).toEqual({ ok: true });
  });

  it("rejects JPEG favicon", () => {
    const result = validateFavicon({ mime: "image/jpeg", bytes: pad(JPEG_HEADER, 1024) });
    expect(result.ok).toBe(false);
  });

  it("rejects > 256 KB", () => {
    const big = Buffer.concat([PNG_HEADER, Buffer.alloc(256 * 1024 + 1)]);
    expect(validateFavicon({ mime: "image/png", bytes: big }).ok).toBe(false);
  });
});

describe("validatePrimaryColor", () => {
  it("accepts lowercase hex", () => {
    expect(validatePrimaryColor("#0a2bff")).toEqual({ ok: true, value: "#0a2bff" });
  });

  it("accepts uppercase hex and normalizes to lowercase", () => {
    expect(validatePrimaryColor("#0A2BFF")).toEqual({ ok: true, value: "#0a2bff" });
  });

  it("accepts null (clear)", () => {
    expect(validatePrimaryColor(null)).toEqual({ ok: true, value: null });
  });

  it("rejects 3-char shorthand", () => {
    expect(validatePrimaryColor("#abc").ok).toBe(false);
  });

  it("rejects missing #", () => {
    expect(validatePrimaryColor("0a2bff").ok).toBe(false);
  });

  it("rejects non-hex chars", () => {
    expect(validatePrimaryColor("#zzzzzz").ok).toBe(false);
  });
});
