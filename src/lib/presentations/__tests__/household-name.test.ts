import { describe, it, expect } from "vitest";
import { formatHouseholdName } from "../household-name";

describe("formatHouseholdName", () => {
  it("returns the primary name alone when there is no Co-client", () => {
    expect(formatHouseholdName("Frank Doyle", null)).toBe("Frank Doyle");
    expect(formatHouseholdName("Frank Doyle", "")).toBe("Frank Doyle");
    expect(formatHouseholdName("Frank Doyle", "   ")).toBe("Frank Doyle");
  });

  it("folds the shared surname when the Co-client field is a bare first name", () => {
    expect(formatHouseholdName("Frank Doyle", "Anita")).toBe("Frank & Anita Doyle");
  });

  it("folds the shared surname when the Co-client field repeats the surname", () => {
    expect(formatHouseholdName("Frank Doyle", "Anita Doyle")).toBe("Frank & Anita Doyle");
    expect(formatHouseholdName("Cooper Sample", "Susan Sample")).toBe("Cooper & Susan Sample");
  });

  it("keeps both names in full when the surnames differ", () => {
    expect(formatHouseholdName("Frank Doyle", "Anita Jackson")).toBe(
      "Frank Doyle & Anita Jackson",
    );
  });

  it("is case-insensitive when comparing surnames", () => {
    expect(formatHouseholdName("Frank Doyle", "Anita DOYLE")).toBe("Frank & Anita Doyle");
  });

  it("collapses stray whitespace", () => {
    expect(formatHouseholdName("  Frank   Doyle ", "  Anita  ")).toBe("Frank & Anita Doyle");
  });

  it("falls back to a simple join when the primary has no surname", () => {
    expect(formatHouseholdName("Frank", "Anita")).toBe("Frank & Anita");
  });
});
