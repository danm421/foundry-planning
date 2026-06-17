import { describe, it, expect } from "vitest";
import { maskAccountNumber } from "../account-mask";
import { maskSsnLast4 } from "../account-mask";

describe("maskAccountNumber", () => {
  it("masks all but the last 4 of a long number", () => {
    expect(maskAccountNumber("123456789")).toBe("••••6789");
  });
  it("fully masks a short number (<= 4 chars)", () => {
    expect(maskAccountNumber("12")).toBe("••");
    expect(maskAccountNumber("1234")).toBe("••••");
  });
  it("trims surrounding whitespace before masking", () => {
    expect(maskAccountNumber("  987654321  ")).toBe("••••4321");
  });
  it("returns empty string for null/undefined/blank", () => {
    expect(maskAccountNumber(null)).toBe("");
    expect(maskAccountNumber(undefined)).toBe("");
    expect(maskAccountNumber("   ")).toBe("");
  });
});

describe("maskSsnLast4", () => {
  it("renders •••-••-1234 for a 4-digit last4", () => { expect(maskSsnLast4("1234")).toBe("•••-••-1234"); });
  it("returns empty string for null/empty", () => { expect(maskSsnLast4(null)).toBe(""); expect(maskSsnLast4("")).toBe(""); });
  it("masks any over-length input to its last 4 (never echoes more)", () => { expect(maskSsnLast4("987654321")).toBe("•••-••-4321"); });
});
