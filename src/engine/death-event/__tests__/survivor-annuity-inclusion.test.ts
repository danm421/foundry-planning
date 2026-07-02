import { describe, it, expect } from "vitest";
import { computeSurvivorAnnuityInclusion } from "../survivor-annuity-inclusion";
import type { Income } from "../../types";

const pension: Income = {
  id: "p1", type: "deferred", name: "VA Benefit", annualAmount: 51_576,
  startYear: 2027, endYear: 2068, growthRate: 0.024, owner: "spouse",
  survivorshipPct: 0.5,
};

describe("computeSurvivorAnnuityInclusion", () => {
  it("emits one gross-estate line for a deferred income owned by the decedent", () => {
    const { lines } = computeSurvivorAnnuityInclusion({
      incomes: [pension], deceased: "spouse", deathYear: 2050,
      survivorBirthYear: 1965, survivorLifeExpectancy: 90,
      planSettings: { pvDiscountRate: 0.024, inflationRate: 0.024 },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBeGreaterThan(0);
    expect(lines[0].accountId).toBeNull();
    expect(lines[0].liabilityId).toBeNull();
    expect(lines[0].label).toMatch(/survivor/i);
  });

  it("emits nothing for a non-deferred / zero-pct / non-decedent income", () => {
    const none = computeSurvivorAnnuityInclusion({
      incomes: [{ ...pension, owner: "client" }], deceased: "spouse", deathYear: 2050,
      survivorBirthYear: 1965, survivorLifeExpectancy: 90,
      planSettings: { pvDiscountRate: 0.024, inflationRate: 0.024 },
    });
    expect(none.lines).toHaveLength(0);
  });

  it("emits nothing for a deferred income driven by scheduleOverrides", () => {
    // scheduleOverrides bypasses annualAmount·growth — the stream the PV helper
    // values is never paid, so survivorship is unsupported for override-driven
    // incomes and no inclusion line is emitted.
    const none = computeSurvivorAnnuityInclusion({
      incomes: [{ ...pension, scheduleOverrides: { 2041: 40_000 } }],
      deceased: "spouse", deathYear: 2050,
      survivorBirthYear: 1965, survivorLifeExpectancy: 90,
      planSettings: { pvDiscountRate: 0.024, inflationRate: 0.024 },
    });
    expect(none.lines).toHaveLength(0);
  });

  it("emits nothing when survivor life expectancy is unknown", () => {
    const none = computeSurvivorAnnuityInclusion({
      incomes: [pension], deceased: "spouse", deathYear: 2050,
      survivorBirthYear: null, survivorLifeExpectancy: null,
      planSettings: { pvDiscountRate: 0.024, inflationRate: 0.024 },
    });
    expect(none.lines).toHaveLength(0);
  });

  it("returns a marital deduction equal to the summed inclusion PV by default", () => {
    const r = computeSurvivorAnnuityInclusion({
      incomes: [pension], deceased: "spouse", deathYear: 2050,
      survivorBirthYear: 1965, survivorLifeExpectancy: 90,
      planSettings: { pvDiscountRate: 0.024, inflationRate: 0.024 },
    });
    expect(r.maritalDeduction).toBeGreaterThan(0);
    expect(r.maritalDeduction).toBeCloseTo(r.lines[0].amount, 6);
  });

  it("emits the gross line but zero marital deduction when QTIP is elected out", () => {
    const r = computeSurvivorAnnuityInclusion({
      incomes: [{ ...pension, survivorAnnuityQtipElectOut: true }],
      deceased: "spouse", deathYear: 2050,
      survivorBirthYear: 1965, survivorLifeExpectancy: 90,
      planSettings: { pvDiscountRate: 0.024, inflationRate: 0.024 },
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].amount).toBeGreaterThan(0);
    expect(r.maritalDeduction).toBe(0);
  });
});
