import { describe, expect, it } from "vitest";
import { PDF_THEME, resolveAccentColor } from "../theme";

describe("resolveAccentColor", () => {
  it("returns the validated firm color when present and well-formed", () => {
    expect(resolveAccentColor("#0066cc")).toBe("#0066cc");
    expect(resolveAccentColor("#ABCDEF")).toBe("#ABCDEF");
  });

  it("falls back to PDF_THEME.accent when null", () => {
    expect(resolveAccentColor(null)).toBe(PDF_THEME.accent);
  });

  it("falls back to PDF_THEME.accent when the hex is malformed", () => {
    expect(resolveAccentColor("nope")).toBe(PDF_THEME.accent);
    expect(resolveAccentColor("#fff")).toBe(PDF_THEME.accent); // 3-digit shorthand not allowed
    expect(resolveAccentColor("")).toBe(PDF_THEME.accent);
  });
});
