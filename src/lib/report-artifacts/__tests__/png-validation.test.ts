import { describe, it, expect } from "vitest";
import { isSafePngDataUri } from "../png-validation";

describe("isSafePngDataUri", () => {
  it("accepts valid base64 PNG data URI under cap", () => {
    expect(isSafePngDataUri("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
  });

  it("rejects non-PNG mimetypes", () => {
    expect(isSafePngDataUri("data:image/jpeg;base64,xxx")).toBe(false);
    expect(isSafePngDataUri("data:image/svg+xml;base64,xxx")).toBe(false);
  });

  it("rejects http(s) URLs (SSRF guard)", () => {
    expect(isSafePngDataUri("http://example.com/x.png")).toBe(false);
    expect(isSafePngDataUri("https://example.com/x.png")).toBe(false);
    expect(isSafePngDataUri("http://169.254.169.254/")).toBe(false); // IMDS
  });

  it("rejects file:// and javascript:", () => {
    expect(isSafePngDataUri("file:///etc/passwd")).toBe(false);
    expect(isSafePngDataUri("javascript:alert(1)")).toBe(false);
  });

  it("rejects oversized payloads", () => {
    const big = "data:image/png;base64," + "A".repeat(2_000_001);
    expect(isSafePngDataUri(big)).toBe(false);
  });

  it("rejects non-string inputs", () => {
    expect(isSafePngDataUri(null)).toBe(false);
    expect(isSafePngDataUri(undefined)).toBe(false);
    expect(isSafePngDataUri(123)).toBe(false);
    expect(isSafePngDataUri({})).toBe(false);
  });
});
