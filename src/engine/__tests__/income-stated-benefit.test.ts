// src/engine/__tests__/income-stated-benefit.test.ts
import { describe, it, expect } from "vitest";
import { computeIncome } from "../income";
import type { Income, ClientInfo } from "../types";

const douglas: ClientInfo = {
  firstName: "Paul", lastName: "Douglas", dateOfBirth: "1958-02-24",
  retirementAge: 70, planEndAge: 97, filingStatus: "married_joint",
  spouseDob: "1960-07-16", spouseLifeExpectancy: 95, lifeExpectancy: 95,
};

// The LEGACY shape exactly as prod stores Paul today: no stated age.
const paul: Income = {
  id: "p", type: "social_security", name: "SS — Paul", annualAmount: 68478,
  startYear: 2028, endYear: 2071, growthRate: 0.02, inflationStartYear: 2026,
  owner: "client", claimingAge: 70, claimingAgeMonths: 0, claimingAgeMode: "years",
  ssBenefitMode: "manual_amount",
};
const cynthia: Income = {
  id: "c", type: "social_security", name: "SS — Cynthia", annualAmount: 0,
  startYear: 2027, endYear: 2071, growthRate: 0.02, inflationStartYear: 2026,
  owner: "spouse", claimingAge: 67, claimingAgeMonths: 0, claimingAgeMode: "fra",
  ssBenefitMode: "pia_at_fra", piaMonthly: 0,
};

/** What the literal path paid before this change: amount × COLA × months/12. */
function oldLiteral(year: number): number {
  const months = year === 2028 ? 11 : 12;
  return 68478 * Math.pow(1.02, year - 2026) * (months / 12);
}

describe("computeIncome routes stated benefits through the orchestrator", () => {
  it("Paul's own benefit is unchanged to the cent, every year, with COLA", () => {
    for (const year of [2028, 2029, 2035, 2050]) {
      const r = computeIncome([paul, cynthia], year, douglas);
      expect(r.bySource.p).toBeCloseTo(oldLiteral(year), 6);
      expect(r.socialSecurityDetail?.client.retirement).toBeCloseTo(oldLiteral(year), 6);
    }
  });

  it("Cynthia now shows a Spousal benefit, and nothing is left for a residual column", () => {
    const r = computeIncome([paul, cynthia], 2029, douglas);
    expect(r.socialSecurityDetail?.spouse?.spousal).toBeGreaterThan(0);
    const d = r.socialSecurityDetail!;
    const detailed = d.client.retirement + d.client.spousal + d.client.survivor
      + (d.spouse?.retirement ?? 0) + (d.spouse?.spousal ?? 0) + (d.spouse?.survivor ?? 0);
    expect(r.socialSecurity).toBeCloseTo(detailed, 6);
  });

  it("a stated row with a year-by-year schedule still pays the schedule (literal path)", () => {
    const scheduled = { ...paul, scheduleOverrides: { 2029: 12345 } };
    const r = computeIncome([scheduled], 2029, douglas);
    expect(r.bySource.p).toBeCloseTo(12345, 6);
    expect(r.socialSecurityDetail).toBeUndefined();
  });

  it("a single client (no spouse row) still pays the stated amount", () => {
    const r = computeIncome([paul], 2030, douglas);
    expect(r.bySource.p).toBeCloseTo(oldLiteral(2030), 6);
  });

  it("No benefit on the other spouse: no spousal, no crash", () => {
    const none = { ...cynthia, ssBenefitMode: "no_benefit" as const };
    const r = computeIncome([paul, none], 2030, douglas);
    expect(r.bySource.c ?? 0).toBe(0);
    expect(r.socialSecurityDetail?.client.spousal).toBe(0);
  });

  it("an imported whole-age figure (claim 67y0m, quoted 67y0m) pays exactly that figure", () => {
    const imported: Income = {
      ...paul, id: "i", annualAmount: 30000, growthRate: 0, inflationStartYear: 2030,
      claimingAge: 67, claimingAgeMonths: 0, ssStatedAge: 67, ssStatedAgeMonths: 0,
    };
    expect(computeIncome([imported], 2032, douglas).bySource.i).toBeCloseTo(30000, 6);
  });

  // Tax reconciliation's "Set benefit to the return's figure" writes the check ACTUALLY PAID and
  // clears the stated age. A row left pinned at 70 would be reduced again from a 67 claim.
  it("a row written with the return's figure and no stated age pays exactly that figure", () => {
    const gross = 30000;
    const set: Income = {
      ...paul, id: "t", annualAmount: gross, growthRate: 0, inflationStartYear: 2030,
      claimingAge: 67, ssStatedAge: null, ssStatedAgeMonths: null,
    };
    const r = computeIncome([set], 2032, douglas);
    expect(r.bySource.t).toBeCloseTo(gross, 6);
    // Control: the same figure still pinned at 70 would be re-reduced for the 67 claim.
    const pinned = computeIncome([{ ...set, ssStatedAge: 70 }], 2032, douglas);
    expect(pinned.bySource.t).toBeLessThan(gross);
  });
});
