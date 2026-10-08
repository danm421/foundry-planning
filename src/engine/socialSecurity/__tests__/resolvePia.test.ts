// src/engine/socialSecurity/__tests__/resolvePia.test.ts
import { describe, it, expect } from "vitest";
import { resolvePiaMonthly, statedAgeMonths } from "../resolvePia";
import { computeOwnMonthlyBenefit } from "../ownRetirement";
import type { Income, ClientInfo } from "../../types";

const client: ClientInfo = {
  firstName: "Paul", lastName: "Douglas", dateOfBirth: "1958-02-24", // FRA 66y 8m
  retirementAge: 70, planEndAge: 97, filingStatus: "married_joint",
  spouseDob: "1960-07-16", spouseLifeExpectancy: 95, lifeExpectancy: 95,
};

function row(o: Partial<Income>): Income {
  return {
    id: "r", type: "social_security", name: "SS", annualAmount: 0,
    startYear: 2026, endYear: 2099, growthRate: 0, owner: "client",
    claimingAge: 70, claimingAgeMonths: 0, claimingAgeMode: "years",
    ssBenefitMode: "manual_amount", ...o,
  };
}

// Paul at 70: 40 months of delayed credit at 2/3% a month.
const PAUL_FACTOR = 1 + 40 * (2 / 300);

describe("resolvePiaMonthly", () => {
  it("pia_at_fra returns the stored PIA; 0 stays 0 (no work record); unset is null", () => {
    expect(resolvePiaMonthly(row({ ssBenefitMode: "pia_at_fra", piaMonthly: 2000 }), client)).toBe(2000);
    expect(resolvePiaMonthly(row({ ssBenefitMode: "pia_at_fra", piaMonthly: 0 }), client)).toBe(0);
    expect(resolvePiaMonthly(row({ ssBenefitMode: "pia_at_fra", piaMonthly: undefined }), client)).toBeNull();
  });

  it("no_benefit is null", () => {
    expect(resolvePiaMonthly(row({ ssBenefitMode: "no_benefit", annualAmount: 30000 }), client)).toBeNull();
  });

  it("divides a stated amount back out of the factor at the stated age (Douglas: $68,478/yr at 70 → $4,505.13 PIA)", () => {
    const pia = resolvePiaMonthly(row({ annualAmount: 68478, ssStatedAge: 70, ssStatedAgeMonths: 0 }), client)!;
    expect(pia).toBeCloseTo(68478 / 12 / PAUL_FACTOR, 6);
    expect(pia).toBeCloseTo(4505.13, 2);
  });

  it("a NULL stated age means the claim age (legacy rows)", () => {
    const legacy = resolvePiaMonthly(row({ annualAmount: 68478 }), client);
    const pinned = resolvePiaMonthly(row({ annualAmount: 68478, ssStatedAge: 70 }), client);
    expect(legacy).toBeCloseTo(pinned!, 9);
  });

  it("the PIA does not depend on the claim age once the stated age is pinned", () => {
    const at67 = resolvePiaMonthly(row({ annualAmount: 68478, ssStatedAge: 70, claimingAge: 67 }), client);
    expect(at67).toBeCloseTo(68478 / 12 / PAUL_FACTOR, 6);
  });

  it("a NULL mode reads as a stated amount, matching the UI", () => {
    expect(resolvePiaMonthly(row({ ssBenefitMode: undefined, annualAmount: 68478 }), client))
      .toBeCloseTo(68478 / 12 / PAUL_FACTOR, 6);
  });

  it("an age past 70 prices as 70 (no delayed credit after 70)", () => {
    const at72 = resolvePiaMonthly(row({ annualAmount: 68478, ssStatedAge: 72 }), client);
    expect(at72).toBeCloseTo(68478 / 12 / PAUL_FACTOR, 6);
  });

  it("uses the SPOUSE's date of birth for a spouse row", () => {
    // Cynthia, born 1960: FRA 67 → a figure stated at 67 IS the PIA.
    const pia = resolvePiaMonthly(row({ owner: "spouse", annualAmount: 29016, ssStatedAge: 67 }), client);
    expect(pia).toBeCloseTo(2418, 6);
  });

  it("is null — paid as a literal amount — when it cannot be priced", () => {
    expect(resolvePiaMonthly(row({ annualAmount: 30000, scheduleOverrides: { 2030: 30000 } }), client)).toBeNull();
    expect(resolvePiaMonthly(row({ annualAmount: 30000, claimingAge: undefined }), client)).toBeNull();
    expect(resolvePiaMonthly(row({ owner: "spouse", annualAmount: 30000 }), { ...client, spouseDob: undefined })).toBeNull();
    expect(resolvePiaMonthly({ ...row({}), type: "salary" }, client)).toBeNull();
  });
});

describe("an amount stated at the claim age round-trips EXACTLY (the 8 converted households)", () => {
  const cases: Array<[string, number]> = [
    ["1958-02-24", 70 * 12],     // mid-month, delayed
    ["1960-06-01", 62 * 12],     // born on the 1st, earliest
    ["1962-01-02", 66 * 12 + 6], // Jan 2nd, early with months
    ["1955-12-31", 67 * 12],
  ];
  for (const [dob, claimAgeMonths] of cases) {
    it(`${dob} claiming at ${Math.floor(claimAgeMonths / 12)}y ${claimAgeMonths % 12}m`, () => {
      const c = { ...client, dateOfBirth: dob };
      const r = row({
        annualAmount: 41234.56,
        claimingAge: Math.floor(claimAgeMonths / 12),
        claimingAgeMonths: claimAgeMonths % 12,
      });
      const pia = resolvePiaMonthly(r, c)!;
      expect(computeOwnMonthlyBenefit({ piaMonthly: pia, claimAgeMonths, dob }) * 12).toBeCloseTo(41234.56, 6);
    });
  }
});

describe("statedAgeMonths", () => {
  it("prefers the stated age, else the claim age", () => {
    expect(statedAgeMonths(row({ ssStatedAge: 68, ssStatedAgeMonths: 6 }), client)).toBe(822);
    expect(statedAgeMonths(row({ claimingAge: 67, claimingAgeMonths: 3 }), client)).toBe(807);
  });
});
