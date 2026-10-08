// src/engine/socialSecurity/__tests__/orchestrator-stated-benefit.test.ts
import { describe, it, expect } from "vitest";
import { resolveAnnualBenefit } from "../orchestrator";
import type { Income, ClientInfo } from "../../types";

// Paul b. 1958-02-24 (FRA 66y8m) claims at 70 → entitled Feb 2028 → 11 payments in 2028.
// Cynthia b. 1960-07-16 (FRA 67) claims at FRA → entitled Jul 2027.
// Both live to 95: Paul's last year 2053, Cynthia's 2055.
const douglas: ClientInfo = {
  firstName: "Paul", lastName: "Douglas", dateOfBirth: "1958-02-24",
  retirementAge: 70, planEndAge: 97, filingStatus: "married_joint",
  spouseDob: "1960-07-16", spouseLifeExpectancy: 95, lifeExpectancy: 95,
};

function ss(o: Partial<Income>): Income {
  return {
    id: "x", type: "social_security", name: "SS", annualAmount: 0,
    startYear: 2026, endYear: 2099, growthRate: 0, inflationStartYear: 2026,
    owner: "client", claimingAge: 70, claimingAgeMonths: 0, claimingAgeMode: "years",
    ...o,
  };
}

const paul = ss({ id: "p", owner: "client", ssBenefitMode: "manual_amount", annualAmount: 68478, ssStatedAge: 70, ssStatedAgeMonths: 0 });
const cynthia = ss({ id: "c", owner: "spouse", ssBenefitMode: "pia_at_fra", piaMonthly: 0, claimingAgeMode: "fra", claimingAge: 67 });

const PAUL_PIA = 68478 / 12 / (1 + 40 * (2 / 300)); // 4505.1316
const PAUL_AT_70 = 68478 / 12;                      // 5706.50

describe("spousal + survivor off a benefit stated at an age", () => {
  it("Paul's own benefit is exactly his stated $68,478/yr (11 payments in 2028)", () => {
    const out = resolveAnnualBenefit({ row: paul, spouseRow: cynthia, client: douglas, year: 2028 });
    expect(out.retirement).toBeCloseTo(PAUL_AT_70 * 11, 2);
    expect(out.spousal).toBe(0);
  });

  it("Cynthia (PIA $0) gets nothing in 2027 — Paul has not filed", () => {
    const out = resolveAnnualBenefit({ row: cynthia, spouseRow: paul, client: douglas, year: 2027 });
    expect(out.total).toBe(0);
  });

  it("Cynthia draws half of Paul's PIA from his filing month (Feb 2028)", () => {
    const y2028 = resolveAnnualBenefit({ row: cynthia, spouseRow: paul, client: douglas, year: 2028 });
    expect(y2028.spousal).toBeCloseTo(PAUL_PIA * 0.5 * 11, 2);
    const y2029 = resolveAnnualBenefit({ row: cynthia, spouseRow: paul, client: douglas, year: 2029 });
    expect(y2029.spousal).toBeCloseTo(PAUL_PIA * 0.5 * 12, 2); // ≈ $27,030.79
  });

  it("an own benefit larger than half Paul's PIA means no top-up ($2,418 > $2,252.57)", () => {
    const withOwn = { ...cynthia, piaMonthly: 2418 };
    const out = resolveAnnualBenefit({ row: withOwn, spouseRow: paul, client: douglas, year: 2029 });
    expect(out.spousal).toBe(0);
    expect(out.retirement).toBeCloseTo(2418 * 12, 2);
  });

  it("after Paul dies (2053), Cynthia gets his full age-70 benefit as a survivor", () => {
    const out = resolveAnnualBenefit({ row: cynthia, spouseRow: paul, client: douglas, year: 2054 });
    expect(out.survivor).toBeCloseTo(PAUL_AT_70 * 12, 2); // $68,478
    expect(out.spousal).toBe(0);
  });

  it("a LEGACY stated row (no stated age) behaves the same — the 8 converted households", () => {
    const legacyPaul = { ...paul, ssStatedAge: undefined, ssStatedAgeMonths: undefined };
    const out = resolveAnnualBenefit({ row: cynthia, spouseRow: legacyPaul, client: douglas, year: 2029 });
    expect(out.spousal).toBeCloseTo(PAUL_PIA * 0.5 * 12, 2);
  });

  it("claiming earlier than the stated age is reduced (stated at 70, claimed at 67)", () => {
    const early = { ...paul, claimingAge: 67, claimingAgeMonths: 0 };
    // 67y0m is 4 months past Paul's FRA (66y8m): 4 × 2/3% delayed credit.
    const out = resolveAnnualBenefit({ row: early, spouseRow: cynthia, client: douglas, year: 2030 });
    expect(out.retirement).toBeCloseTo(PAUL_PIA * (1 + 4 * (2 / 300)) * 12, 2);
  });
});
