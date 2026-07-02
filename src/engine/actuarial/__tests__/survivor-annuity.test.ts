import { describe, it, expect } from "vitest";
import { survivorAnnuityPresentValue } from "../survivor-annuity";
import { survivalProbability } from "../mortality";

// A tiny hand-checkable case: no growth, no discount, forced survival by using
// a young survivor over a 1-year window so P(survive 1yr) ≈ 1.
describe("survivorAnnuityPresentValue", () => {
  const base = {
    annualAmount: 100_000, growthRate: 0, startYear: 2027,
    inflationStartYear: null, survivorshipPct: 0.5,
    deathYear: 2040, discountRate: 0,
  };

  it("returns 0 when the survivor stream has no years (survivor dies same year)", () => {
    expect(survivorAnnuityPresentValue({
      ...base, survivorAgeAtDeath: 60, survivorDeathYear: 2040,
    })).toBe(0);
  });

  it("single-year, no discount, no growth ≈ pct × amount × P(survive 1yr)", () => {
    const p = survivalProbability(60, 1);
    const pv = survivorAnnuityPresentValue({
      ...base, survivorAgeAtDeath: 60, survivorDeathYear: 2041,
    });
    expect(pv).toBeCloseTo(0.5 * 100_000 * p, 4);
  });

  it("discounting reduces PV; higher discount → lower PV", () => {
    const low = survivorAnnuityPresentValue({ ...base, discountRate: 0.02, survivorAgeAtDeath: 60, survivorDeathYear: 2050 });
    const high = survivorAnnuityPresentValue({ ...base, discountRate: 0.08, survivorAgeAtDeath: 60, survivorDeathYear: 2050 });
    expect(high).toBeLessThan(low);
  });

  it("grows the nominal benefit at growthRate before discounting", () => {
    const flat = survivorAnnuityPresentValue({ ...base, growthRate: 0, survivorAgeAtDeath: 60, survivorDeathYear: 2050 });
    const growing = survivorAnnuityPresentValue({ ...base, growthRate: 0.03, survivorAgeAtDeath: 60, survivorDeathYear: 2050 });
    expect(growing).toBeGreaterThan(flat);
  });
});
