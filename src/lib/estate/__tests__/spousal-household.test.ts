import { describe, it, expect } from "vitest";
import { hasSpouseForEstate } from "@/lib/estate/spousal-household";

describe("hasSpouseForEstate", () => {
  it("treats a household with a spouse DOB as spousal (second death modeled)", () => {
    expect(hasSpouseForEstate("1951-05-01")).toBe(true);
  });

  it("regression: spouse present but files single is still spousal", () => {
    // The Doyle case — filingStatus "single" but a spouse (Anita) exists with a
    // DOB, so the engine computes a second death routing to the children. The
    // estate UI must agree and show the second-death column. Filing status is
    // deliberately NOT an input here.
    expect(hasSpouseForEstate("1951-05-01")).toBe(true);
  });

  it("treats a household with no spouse DOB as single (no second death)", () => {
    expect(hasSpouseForEstate(null)).toBe(false);
    expect(hasSpouseForEstate(undefined)).toBe(false);
  });
});
