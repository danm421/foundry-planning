import { describe, it, expect } from "vitest";
import { isSpouseLifeExpectancyDefaulted } from "../shared";

describe("isSpouseLifeExpectancyDefaulted", () => {
  it("F17: detects a defaulted spouse life expectancy", () => {
    // Spouse DOB present but no life expectancy → engine assumes age 95 (fabricated).
    expect(
      isSpouseLifeExpectancyDefaulted({
        spouseDob: "1960-01-01",
        spouseLifeExpectancy: null,
      } as never),
    ).toBe(true);

    // Spouse DOB present AND life expectancy set → not defaulted.
    expect(
      isSpouseLifeExpectancyDefaulted({
        spouseDob: "1960-01-01",
        spouseLifeExpectancy: 90,
      } as never),
    ).toBe(false);

    // No spouse → nothing to default; the ?? 95 fallback never applies.
    expect(
      isSpouseLifeExpectancyDefaulted({
        spouseDob: null,
        spouseLifeExpectancy: null,
      } as never),
    ).toBe(false);

    // Spouse DOB present, life expectancy undefined (not just null) → defaulted.
    expect(
      isSpouseLifeExpectancyDefaulted({
        spouseDob: "1960-01-01",
      } as never),
    ).toBe(true);
  });
});
