import { describe, it, expect } from "vitest";
import { isSpouseLifeExpectancyDefaulted, applyIncomeTermination } from "../shared";
import type { Income } from "../../types";

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

const deferred = (over: Partial<Income> = {}): Income => ({
  id: "i1", type: "deferred", name: "Pension", annualAmount: 60_000,
  startYear: 2027, endYear: 2050, growthRate: 0.02, owner: "client",
  survivorshipPct: 0.5, ...over,
});

describe("applyIncomeTermination survivor continuation", () => {
  it("retitles + scales a deferred income when survivorContinuation is passed", () => {
    const [out] = applyIncomeTermination([deferred()], "client", "spouse", 2040, { survivorDeathYear: 2060 });
    expect(out.owner).toBe("spouse");
    expect(out.annualAmount).toBeCloseTo(30_000, 6);
    expect(out.endYear).toBe(2060);
    // growth base preserved so projected value = pct × original
    expect(out.growthRate).toBe(0.02);
    expect(out.inflationStartYear ?? out.startYear).toBe(2027);
  });

  it("still clips when survivorshipPct is 0/undefined", () => {
    const [out] = applyIncomeTermination([deferred({ survivorshipPct: 0 })], "client", "spouse", 2040, { survivorDeathYear: 2060 });
    expect(out.owner).toBe("client");
    expect(out.endYear).toBe(2040);
  });

  it("does not continue a non-deferred income even with a survivorship value", () => {
    const [out] = applyIncomeTermination([deferred({ type: "salary" })], "client", "spouse", 2040, { survivorDeathYear: 2060 });
    expect(out.owner).toBe("client");
    expect(out.endYear).toBe(2040);
  });

  it("falls back to clip when survivorContinuation is omitted (final-death path)", () => {
    const [out] = applyIncomeTermination([deferred()], "client", "client", 2040);
    expect(out.owner).toBe("client");
    expect(out.endYear).toBe(2040);
  });
});
